const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, pool } = require('./database');
const { requireAuth } = require('./auth');
const { pushBalanceUpdate } = require('./wallet_socket');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Daily Cashback                                                      */
/*                                                                       */
/*  Rule: once per rolling 24h, a user may claim cashback equal to 10%   */
/*  of the deposits they made TODAY (last 24h), but only if:            */
/*    1. Their current balance is 0 (i.e. they've lost everything they  */
/*       had) - no partial cashback for a partial loss.                 */
/*    2. They have NEVER submitted a withdrawal request, in ANY status  */
/*       (pending/approved/rejected). A single withdraw attempt, ever,  */
/*       permanently disqualifies the account from cashback - this is   */
/*       intentional and irreversible.                                  */
/*    3. They haven't already claimed cashback in the last 24h.         */
/*                                                                        */
/*  Cashback is credited straight to `balance` (not bonus_balance) and  */
/*  recorded as a 'payout' transaction with a distinguishing note, the   */
/*  same pattern referral.js uses to total up commission payouts.       */
/* ------------------------------------------------------------------ */

const CASHBACK_PERCENT = 10;
const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CASHBACK_NOTE = 'Daily cashback';

const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

// Ever attempted a withdrawal, in any status. This is a permanent,
// irreversible disqualifier by design (see comment above) - not scoped to
// "approved" only.
async function hasEverWithdrawn(userId) {
  const { rows } = await query(
    `SELECT 1 FROM transactions WHERE user_id = $1 AND type = 'withdraw' LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// Sum of approved deposits in the last 24h (i.e. "today's" deposits).
async function todaysApprovedDepositCents(userId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS total
     FROM transactions
     WHERE user_id = $1 AND type = 'deposit' AND status = 'approved'
       AND created_at >= NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  return Number(rows[0].total);
}

// Most recent cashback payout, if any, to enforce the 24h cooldown between
// claims.
async function lastCashbackClaimAt(userId) {
  const { rows } = await query(
    `SELECT created_at FROM transactions
     WHERE user_id = $1 AND type = 'payout' AND note = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, CASHBACK_NOTE]
  );
  return rows[0]?.created_at || null;
}

// Shared eligibility computation used by both /status and /claim, so the
// number the user sees on the button and what /claim actually pays out
// can never drift apart.
async function computeEligibility(userId, balanceCents) {
  const [everWithdrawn, depositCents, lastClaimAt] = await Promise.all([
    hasEverWithdrawn(userId),
    todaysApprovedDepositCents(userId),
    lastCashbackClaimAt(userId),
  ]);

  const now = Date.now();
  const cooldownEndsAt = lastClaimAt ? new Date(lastClaimAt).getTime() + CLAIM_COOLDOWN_MS : 0;
  const onCooldown = cooldownEndsAt > now;
  const secondsUntilNextClaim = onCooldown ? Math.ceil((cooldownEndsAt - now) / 1000) : 0;

  const hasLostEverything = balanceCents === 0;
  const cashbackCents = Math.round(depositCents * (CASHBACK_PERCENT / 100));

  const eligible =
    !everWithdrawn && hasLostEverything && depositCents > 0 && cashbackCents > 0 && !onCooldown;

  let reason = null;
  if (everWithdrawn) reason = 'not_eligible_withdrawn';
  else if (!hasLostEverything) reason = 'balance_not_zero';
  else if (depositCents <= 0) reason = 'no_deposit_today';
  else if (onCooldown) reason = 'cooldown';

  return {
    eligible,
    reason,
    cashback_amount: cashbackCents / 100,
    deposited_today: depositCents / 100,
    seconds_until_next_claim: secondsUntilNextClaim,
  };
}

// GET /api/cashback/status
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const result = await computeEligibility(req.user.id, req.user.balance);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/cashback/claim
router.post('/claim', requireAuth, claimLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock this user's row so a double-tap (or two requests racing) can't
    // both pass the eligibility check before either has committed - the
    // same guard pattern auth.js uses for the one-time signup bonus.
    const { rows: lockedRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const lockedBalanceCents = lockedRows[0]?.balance ?? 0;

    const everWithdrawn = await hasEverWithdrawn(req.user.id);
    if (everWithdrawn) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cashback is not available on this account' });
    }

    if (lockedBalanceCents !== 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cashback is only available when your balance has been fully lost' });
    }

    const { rows: depRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total
       FROM transactions
       WHERE user_id = $1 AND type = 'deposit' AND status = 'approved'
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [req.user.id]
    );
    const depositCents = Number(depRows[0].total);

    const { rows: lastClaimRows } = await client.query(
      `SELECT created_at FROM transactions
       WHERE user_id = $1 AND type = 'payout' AND note = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, CASHBACK_NOTE]
    );
    const lastClaimAt = lastClaimRows[0]?.created_at || null;
    if (lastClaimAt && Date.now() - new Date(lastClaimAt).getTime() < CLAIM_COOLDOWN_MS) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You can claim cashback again in 24 hours' });
    }

    const cashbackCents = Math.round(depositCents * (CASHBACK_PERCENT / 100));
    if (cashbackCents <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No losses to claim cashback on today' });
    }

    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [cashbackCents, req.user.id]);
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (user_id, type, amount, status, note)
       VALUES ($1, 'payout', $2, 'completed', $3)
       RETURNING *`,
      [req.user.id, cashbackCents, CASHBACK_NOTE]
    );

    await client.query('COMMIT');

    pushBalanceUpdate(req.user.id);

    res.json({
      message: `${(cashbackCents / 100).toFixed(2)} ETB cashback credited to your balance.`,
      cashback_amount: cashbackCents / 100,
      transaction: txRows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
