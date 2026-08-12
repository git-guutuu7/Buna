const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { query, pool } = require('./database');
const { requireAuth } = require('./auth');
const { pushBalanceUpdate } = require('./wallet_socket');

const router = express.Router();

/* ==================================================================== */
/*  CONSTANTS                                                            */
/* ==================================================================== */

// Defaults used only if platform_settings has no row yet for these keys -
// matches what admin.js's GET /api/admin/settings reports as the default.
const DEFAULT_STAKE_BIRR = 10;
const DEFAULT_PLATFORM_FEE_BIRR = 2;
const MIN_PLAYERS_TO_START_COUNTDOWN = 1; // countdown starts as soon as the first player stakes
const COUNTDOWN_MS = 45 * 1000;
const CALL_INTERVAL_MS = 2 * 1000;
const TOTAL_BALLS = 75;

// Reads the current admin-configured stake/fee from platform_settings.
// Called once per round (in ensureRoundOpen) and the result is stored on
// that round's own state - so if an admin changes pricing mid-round, the
// round already in progress keeps charging what it started with, and the
// new pricing only applies starting with the NEXT round that opens.
async function getBingoPricing() {
  const { rows } = await query(
    `SELECT key, value FROM platform_settings WHERE key IN ('bingo_stake_birr', 'bingo_platform_fee_birr')`
  );
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const stakeBirr = parseFloat(settings.bingo_stake_birr ?? String(DEFAULT_STAKE_BIRR));
  const feeBirr = parseFloat(settings.bingo_platform_fee_birr ?? String(DEFAULT_PLATFORM_FEE_BIRR));
  return {
    stakeAmountCents: Math.round(stakeBirr * 100),
    platformFeeCents: Math.round(feeBirr * 100),
  };
}

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
function letterFor(number) {
  return BINGO_LETTERS[Math.floor((number - 1) / 15)];
}
function callLabel(number) {
  return `${letterFor(number)}-${number}`;
}

/* ==================================================================== */
/*  ROUND STATE (in-memory, mirrors game.js's currentRound pattern)      */
/* ==================================================================== */

let currentRound = null; // { round_id, status, calledNumbers: Set, stakes: Map<userId, [cartela_numbers]>, countdownTimer, callTimer }
let ioRef = null;

function generateRoundId() {
  return `BNG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function broadcast(event, payload) {
  if (ioRef) ioRef.emit(event, payload);
}

async function ensureRoundOpen() {
  if (currentRound) return;
  const round_id = generateRoundId();
  const { stakeAmountCents, platformFeeCents } = await getBingoPricing();
  currentRound = {
    round_id,
    status: 'waiting',
    calledNumbers: [],
    countdownTimer: null,
    callTimer: null,
    countdownEndsAt: null,
    stakeAmountCents,
    platformFeeCents,
  };
  await query(
    `INSERT INTO bingo_rounds (round_id, stake_amount, platform_fee_amount, status)
     VALUES ($1, $2, $3, 'waiting')`,
    [round_id, stakeAmountCents, platformFeeCents]
  );
  broadcast('bingo:round_open', publicRoundState());
}

// Called after every successful stake. Starts the 45s countdown as soon as
// the FIRST player stakes, but only starts it once (a 2nd/3rd/4th player
// joining during an active countdown doesn't reset the timer). If only one
// player ends up staking before the countdown ends, they play solo -
// win detection (checkForWinners) and payout math are unchanged and work
// the same for a single active stake as for many: that player wins the
// instant any line on their cartela completes, and is paid the normal
// post-fee share (8 ETB per 10 ETB cartela) exactly as in a multiplayer
// round. If no line completes before all 75 balls are called, the
// platform still keeps the pot, same as any other round.
async function maybeStartCountdown() {
  if (!currentRound || currentRound.status !== 'waiting') return;

  const { rows } = await query(
    'SELECT COUNT(DISTINCT user_id)::int AS count FROM bingo_stakes WHERE round_id = $1',
    [currentRound.round_id]
  );
  const distinctPlayers = rows[0].count;

  if (distinctPlayers >= MIN_PLAYERS_TO_START_COUNTDOWN) {
    currentRound.status = 'countdown';
    currentRound.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    await query(`UPDATE bingo_rounds SET status = 'countdown' WHERE round_id = $1`, [currentRound.round_id]);

    broadcast('bingo:countdown_started', {
      round_id: currentRound.round_id,
      countdown_ms: COUNTDOWN_MS,
      ends_at: currentRound.countdownEndsAt,
    });

    currentRound.countdownTimer = setTimeout(startCalling, COUNTDOWN_MS);
  }
}

async function startCalling() {
  if (!currentRound) return;
  currentRound.status = 'calling';
  await query(`UPDATE bingo_rounds SET status = 'calling', started_at = now() WHERE round_id = $1`, [
    currentRound.round_id,
  ]);

  broadcast('bingo:calling_started', { round_id: currentRound.round_id });

  currentRound.callTimer = setInterval(async () => {
    try {
      await callNextNumber();
    } catch (err) {
      console.error('[bingo] Error during call tick', { error: err.message });
    }
  }, CALL_INTERVAL_MS);
}

async function callNextNumber() {
  if (!currentRound || currentRound.status !== 'calling') return;

  const remaining = [];
  for (let n = 1; n <= TOTAL_BALLS; n++) {
    if (!currentRound.calledNumbers.includes(n)) remaining.push(n);
  }

  if (remaining.length === 0) {
    // All 75 balls called, nobody won - platform keeps the entire pot.
    await finishRoundNoWinner();
    return;
  }

  const next = remaining[Math.floor(Math.random() * remaining.length)];
  currentRound.calledNumbers.push(next);

  await query(`UPDATE bingo_rounds SET called_numbers = $1 WHERE round_id = $2`, [
    JSON.stringify(currentRound.calledNumbers),
    currentRound.round_id,
  ]);

  broadcast('bingo:number_called', {
    round_id: currentRound.round_id,
    number: next,
    label: callLabel(next),
    called_numbers: currentRound.calledNumbers,
    balls_called: currentRound.calledNumbers.length,
  });

  // After each call, check every active cartela in this round for a win.
  // This is the server's own authoritative check - a player's "BINGO"
  // button just tells the server to look; it never trusts a client claim
  // of which numbers are marked.
  await checkForWinners();
}

/* ==================================================================== */
/*  WIN DETECTION                                                        */
/* ==================================================================== */

// Given a cartela's flat 25-number grid and the set of numbers called so
// far, returns true if any full row, column, or diagonal is complete.
// The free space (0) always counts as marked.
function hasWinningLine(grid, calledSet) {
  const marked = (i) => grid[i] === 0 || calledSet.has(grid[i]);

  // Rows
  for (let r = 0; r < 5; r++) {
    let complete = true;
    for (let c = 0; c < 5; c++) {
      if (!marked(r * 5 + c)) { complete = false; break; }
    }
    if (complete) return true;
  }
  // Columns
  for (let c = 0; c < 5; c++) {
    let complete = true;
    for (let r = 0; r < 5; r++) {
      if (!marked(r * 5 + c)) { complete = false; break; }
    }
    if (complete) return true;
  }
  // Diagonals
  let diag1 = true, diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked(i * 5 + i)) diag1 = false;
    if (!marked(i * 5 + (4 - i))) diag2 = false;
  }
  if (diag1 || diag2) return true;

  return false;
}

// Checks every active stake in the current round against the numbers
// called so far. If one or more cartelas now have a winning line, ends
// the round as a win (splitting the pot if there are multiple winners).
// Runs after every single call, so the round ends the instant a line is
// completed rather than waiting for a player to notice and click a button.
async function checkForWinners() {
  if (!currentRound || currentRound.status !== 'calling') return;

  const { rows: activeStakes } = await query(
    `SELECT s.id, s.user_id, s.cartela_number, c.numbers, u.username, u.telegram_first_name
     FROM bingo_stakes s
     JOIN bingo_cartelas c ON c.cartela_number = s.cartela_number
     JOIN users u ON u.id = s.user_id
     WHERE s.round_id = $1 AND s.status = 'active'`,
    [currentRound.round_id]
  );

  const calledSet = new Set(currentRound.calledNumbers);
  const winners = activeStakes.filter((s) => hasWinningLine(s.numbers, calledSet));

  if (winners.length > 0) {
    await finishRoundWithWinners(winners);
  }
}

async function finishRoundWithWinners(winners) {
  if (!currentRound || currentRound.status === 'finished') return;
  clearInterval(currentRound.callTimer);
  currentRound.status = 'finished';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: roundRows } = await client.query(
      'SELECT * FROM bingo_rounds WHERE round_id = $1 FOR UPDATE',
      [currentRound.round_id]
    );
    const round = roundRows[0];
    // The winner(s) split the round's ENTIRE prize pool (every cartela's
    // post-fee stake this round, not just the winning cartela's own
    // stake). With 2 players (2 cartelas @ 8 ETB post-fee each) that's
    // "the winner gets 16 birr"; with a solo player (1 cartela @ 10 ETB
    // stake) that's "the winner gets 8 birr" - same formula, no special
    // casing needed for a single-player round.
    // Uses THIS round's own stored stake/fee (set once when it opened),
    // not whatever the admin-configured pricing happens to be right now -
    // a pricing change mid-round never retroactively changes what's
    // already been staked.
    const payoutPerCartelaCents = round.stake_amount - round.platform_fee_amount;
    const { rows: potRows } = await client.query(
      'SELECT COUNT(*)::int AS cartela_count FROM bingo_stakes WHERE round_id = $1',
      [currentRound.round_id]
    );
    const totalCartelas = potRows[0].cartela_count;
    const fullPrizePool = totalCartelas * payoutPerCartelaCents;
    const perWinnerShare = Math.floor(fullPrizePool / winners.length);
    // Any remainder from integer division goes to the platform rather
    // than being invented out of nowhere or silently dropped.
    const remainder = fullPrizePool - perWinnerShare * winners.length;

    const winnerNames = [];
    for (const winner of winners) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [perWinnerShare, winner.user_id]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, note)
         VALUES ($1, 'payout', $2, 'completed', $3)`,
        [winner.user_id, perWinnerShare, `Bingo win - round ${currentRound.round_id}, cartela #${winner.cartela_number}`]
      );
      await client.query(`UPDATE bingo_stakes SET status = 'won', payout = $1 WHERE id = $2`, [
        perWinnerShare,
        winner.id,
      ]);
      winnerNames.push({
        user_id: winner.user_id,
        name: winner.telegram_first_name || winner.username,
        cartela_number: winner.cartela_number,
        payout: perWinnerShare / 100,
      });
    }

    // Mark every other active stake this round as lost.
    await client.query(
      `UPDATE bingo_stakes SET status = 'lost' WHERE round_id = $1 AND status = 'active'`,
      [currentRound.round_id]
    );

    await client.query(
      `UPDATE bingo_rounds
       SET status = 'finished', outcome = 'won', winner_payout = $1, ended_at = now()
       WHERE round_id = $2`,
      [fullPrizePool, currentRound.round_id]
    );

    await client.query('COMMIT');

    // Push each winner's fresh balance instantly - they see the payout
    // land on their wallet the moment the round finishes, not on the
    // next poll cycle.
    for (const winnerName of winnerNames) {
      pushBalanceUpdate(winnerName.user_id);
    }

    broadcast('bingo:round_finished', {
      round_id: currentRound.round_id,
      outcome: 'won',
      winners: winnerNames,
      prize_pool: fullPrizePool / 100,
      platform_remainder: remainder / 100,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[bingo] Failed to finish round with winners', { error: err.message });
  } finally {
    client.release();
  }

  currentRound = null;
  setTimeout(ensureRoundOpen, 5000);
}

async function finishRoundNoWinner() {
  if (!currentRound || currentRound.status === 'finished') return;
  clearInterval(currentRound.callTimer);
  currentRound.status = 'finished';

  try {
    // Nobody won - the platform keeps the entire pot (all stakes, not
    // just the platform fee portion). All active stakes are marked lost.
    await query(`UPDATE bingo_stakes SET status = 'lost' WHERE round_id = $1 AND status = 'active'`, [
      currentRound.round_id,
    ]);
    const { rows } = await query('SELECT total_pot FROM bingo_rounds WHERE round_id = $1', [currentRound.round_id]);
    const totalPot = rows[0]?.total_pot || 0;

    await query(
      `UPDATE bingo_rounds
       SET status = 'finished', outcome = 'platform_won', platform_earnings = total_pot, ended_at = now()
       WHERE round_id = $1`,
      [currentRound.round_id]
    );

    broadcast('bingo:round_finished', {
      round_id: currentRound.round_id,
      outcome: 'platform_won',
      winners: [],
      message: 'Bingo finished. No winner - the platform takes the round.',
      total_pot: totalPot / 100,
    });
  } catch (err) {
    console.error('[bingo] Failed to finish round with no winner', { error: err.message });
  }

  currentRound = null;
  setTimeout(ensureRoundOpen, 5000);
}

function publicRoundState() {
  if (!currentRound) return null;
  return {
    round_id: currentRound.round_id,
    status: currentRound.status,
    called_numbers: currentRound.calledNumbers,
    countdown_ends_at: currentRound.countdownEndsAt || null,
    stake_amount: currentRound.stakeAmountCents / 100,
  };
}

/* ==================================================================== */
/*  SOCKET ATTACH                                                        */
/* ==================================================================== */

function attachBingoSocket(io) {
  ioRef = io;
  ensureRoundOpen().catch((err) => console.error('[bingo] Failed to open initial round', { error: err.message }));
}

/* ==================================================================== */
/*  HTTP ROUTES                                                          */
/* ==================================================================== */

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

// GET /api/bingo/state - current round status + which cartelas are taken
router.get('/state', requireAuth, async (req, res, next) => {
  try {
    await ensureRoundOpen();

    const { rows: takenRows } = currentRound
      ? await query('SELECT cartela_number, user_id FROM bingo_stakes WHERE round_id = $1', [currentRound.round_id])
      : { rows: [] };

    const { rows: myStakesRows } = currentRound
      ? await query('SELECT cartela_number FROM bingo_stakes WHERE round_id = $1 AND user_id = $2', [
          currentRound.round_id,
          req.user.id,
        ])
      : { rows: [] };

    res.json({
      round: publicRoundState(),
      taken_cartelas: takenRows.map((r) => r.cartela_number),
      my_cartelas: myStakesRows.map((r) => r.cartela_number),
      stake_amount: currentRound.stakeAmountCents / 100,
      platform_fee: currentRound.platformFeeCents / 100,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bingo/cartelas - all 100 cartelas with their numbers (for the picker grid)
router.get('/cartelas', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT cartela_number, numbers FROM bingo_cartelas ORDER BY cartela_number');
    res.json({ cartelas: rows.map((r) => ({ cartela_number: r.cartela_number, numbers: r.numbers })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/bingo/stake - take one or more cartelas in the current round.
// Real balance only - bonus_balance is never used for bingo stakes, and
// is intentionally not checked or drawn from here.
const stakeValidation = [
  body('cartela_numbers')
    .isArray({ min: 1, max: 20 })
    .withMessage('Select at least one cartela')
    .custom((arr) => arr.every((n) => Number.isInteger(n) && n >= 1 && n <= 100))
    .withMessage('Invalid cartela number'),
];

router.post('/stake', requireAuth, stakeValidation, handleValidation, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureRoundOpen();
    if (!currentRound || !['waiting', 'countdown'].includes(currentRound.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This round is no longer accepting new cartelas' });
    }

    const cartelaNumbers = [...new Set(req.body.cartela_numbers)];
    // This round's own stake/fee, fixed when it opened - not whatever the
    // admin-configured pricing happens to be right now, so pricing stays
    // consistent for everyone staking in the same round.
    const roundStakeCents = currentRound.stakeAmountCents;
    const roundFeeCents = currentRound.platformFeeCents;
    const totalStake = cartelaNumbers.length * roundStakeCents;
    const totalFee = cartelaNumbers.length * roundFeeCents;

    // Real balance only - never falls back to bonus_balance.
    const { rows: userRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [
      req.user.id,
    ]);
    const user = userRows[0];
    if (!user || user.balance < totalStake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Make sure none of the requested cartelas are already taken this round.
    const { rows: alreadyTaken } = await client.query(
      'SELECT cartela_number FROM bingo_stakes WHERE round_id = $1 AND cartela_number = ANY($2::int[])',
      [currentRound.round_id, cartelaNumbers]
    );
    if (alreadyTaken.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cartela(s) ${alreadyTaken.map((r) => r.cartela_number).join(', ')} already taken this round`,
      });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [totalStake, req.user.id]);

    for (const cartelaNumber of cartelaNumbers) {
      await client.query(
        `INSERT INTO bingo_stakes (round_id, user_id, cartela_number, stake_amount, platform_fee_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [currentRound.round_id, req.user.id, cartelaNumber, roundStakeCents, roundFeeCents]
      );
    }

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, status, note)
       VALUES ($1, 'bet', $2, 'completed', $3)`,
      [req.user.id, totalStake, `Bingo stake - round ${currentRound.round_id}, cartela(s) ${cartelaNumbers.join(', ')}`]
    );

    await client.query(
      `UPDATE bingo_rounds SET total_pot = total_pot + $1, platform_earnings = platform_earnings + $2 WHERE round_id = $3`,
      [totalStake, totalFee, currentRound.round_id]
    );

    await client.query('COMMIT');

    pushBalanceUpdate(req.user.id);

    broadcast('bingo:cartelas_taken', {
      round_id: currentRound.round_id,
      cartela_numbers: cartelaNumbers,
      user_id: req.user.id,
    });

    // Now that this stake is committed, check whether we've just crossed
    // the 2-distinct-player threshold to start the countdown.
    await maybeStartCountdown();

    res.status(201).json({
      message: `${cartelaNumbers.length} cartela(s) staked`,
      cartela_numbers: cartelaNumbers,
      total_stake: totalStake / 100,
      round_id: currentRound.round_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/bingo/history - past rounds, for the results/history tab
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT round_id, outcome, winner_payout, platform_earnings, ended_at
       FROM bingo_rounds WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 20`
    );
    res.json({
      rounds: rows.map((r) => ({
        round_id: r.round_id,
        outcome: r.outcome,
        winner_payout: r.winner_payout / 100,
        platform_earnings: r.platform_earnings / 100,
        ended_at: r.ended_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, attachBingoSocket };
