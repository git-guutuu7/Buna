const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { body, param, validationResult } = require('express-validator');
const { query, pool } = require('./database');
const { requireAuth, requireAdmin } = require('./auth');
const { getBotInstance } = require('./bot');
const logger = require('./logger');
const { pushBalanceUpdate, getOnlineUserCount } = require('./wallet_socket');

const router = express.Router();

// Every route in this file requires a valid JWT AND the admin role.
router.use(requireAuth, requireAdmin);

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

/* ------------------------------------------------------------------ */
/*  Users                                                               */
/* ------------------------------------------------------------------ */

// GET /api/admin/users - list all users
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const [usersRes, countRes] = await Promise.all([
      query(
        `SELECT id, username, email, role, balance, is_active, created_at
         FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query('SELECT COUNT(*)::int AS count FROM users'),
    ]);

    const total = countRes.rows[0].count;

    res.json({
      users: usersRes.rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        balance: u.balance / 100,
        isActive: u.is_active,
        created_at: u.created_at,
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/status - activate/deactivate (ban/unban) a user account
router.patch(
  '/users/:id/status',
  [param('id').isUUID(), body('isActive').isBoolean()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { rows } = await query(
        'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active',
        [req.body.isActive, req.params.id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: 'User not found' });

      logger.info('Admin updated user status', {
        admin: req.user.username,
        target: user.username,
        isActive: user.is_active,
      });

      res.json({ message: 'User status updated', user: { id: user.id, isActive: user.is_active } });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/admin/users/:id/balance - manually adjust a user's balance
//
// `amount` is signed: positive credits the user, negative debits them.
// A `reason` is required so every manual adjustment is auditable - it's
// stored as a completed 'payout' transaction (credit) or the debit
// equivalent, same as every other balance-affecting transaction in this
// app, so it shows up in transaction history and stats rather than being
// an invisible, unlogged database write. Row-locked the same way
// transaction approval is, so two admins adjusting the same user at once
// can't race each other.
router.patch(
  '/users/:id/balance',
  [
    param('id').isUUID(),
    body('amount')
      .isFloat({ min: -1000000, max: 1000000 })
      .withMessage('Amount must be a number between -1,000,000 and 1,000,000')
      .custom((value) => parseFloat(value) !== 0)
      .withMessage('Amount cannot be zero'),
    body('reason').isString().trim().isLength({ min: 1, max: 300 }).withMessage('A reason is required'),
  ],
  handleValidation,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      const user = userRows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const amountCents = Math.round(parseFloat(req.body.amount) * 100);
      const isCredit = amountCents > 0;

      if (!isCredit && user.balance + amountCents < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Adjustment would make the balance negative' });
      }

      const { rows: updatedRows } = await client.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [amountCents, user.id]
      );

      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, note, approved_by)
         VALUES ($1, 'payout', $2, 'completed', $3, $4)`,
        [
          user.id,
          Math.abs(amountCents),
          `Manual ${isCredit ? 'credit' : 'debit'} by admin: ${req.body.reason.trim()}`,
          req.user.id,
        ]
      );

      await client.query('COMMIT');

      logger.info('Admin manually adjusted user balance', {
        admin: req.user.username,
        target: user.username,
        amount: amountCents / 100,
        reason: req.body.reason.trim(),
      });

      res.json({
        message: 'Balance updated',
        user: { id: user.id, balance: updatedRows[0].balance / 100 },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

/* ------------------------------------------------------------------ */
/*  Transactions - pending queues + approve/reject                      */
/* ------------------------------------------------------------------ */

// GET /api/admin/transactions/pending?type=deposit|withdraw
router.get('/transactions/pending', async (req, res, next) => {
  try {
    let sql = `
      SELECT t.*, u.username, u.email
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      WHERE t.status = 'pending'
    `;
    const params = [];

    if (req.query.type && ['deposit', 'withdraw'].includes(req.query.type)) {
      params.push(req.query.type);
      sql += ` AND t.type = $${params.length}`;
    } else {
      sql += ` AND t.type IN ('deposit', 'withdraw')`;
    }
    sql += ' ORDER BY t.created_at ASC';

    const { rows } = await query(sql, params);

    res.json({
      transactions: rows.map((t) => ({
        id: t.id,
        user: { id: t.user_id, username: t.username, email: t.email },
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        note: t.note,
        telebirr_reference_submitted: t.telebirr_reference_submitted,
        telebirr_phone: t.telebirr_phone,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/transactions - full history, all users, with optional filters
router.get('/transactions', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`t.type = $${params.length}`);
    }
    if (req.query.userId) {
      params.push(req.query.userId);
      conditions.push(`t.user_id = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const listParams = [...params, limit, offset];
    const listSql = `
      SELECT t.*, u.username AS user_username, a.username AS approved_by_username
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN users a ON a.id = t.approved_by
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `SELECT COUNT(*)::int AS count FROM transactions t ${whereClause}`;

    const [itemsRes, countRes] = await Promise.all([
      query(listSql, listParams),
      query(countSql, params),
    ]);

    const total = countRes.rows[0].count;

    res.json({
      transactions: itemsRes.rows.map((t) => ({
        id: t.id,
        user: t.user_id ? { id: t.user_id, username: t.user_username } : null,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        approved_by: t.approved_by_username || null,
        note: t.note,
        telebirr_reference_submitted: t.telebirr_reference_submitted,
        telebirr_phone: t.telebirr_phone,
        telebirr_reference_admin: t.telebirr_reference_admin,
        created_at: t.created_at,
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/transactions/:id/approve
//
// For deposits: approving means the admin has checked the submitted
// Telebirr reference against the real Telebirr business account and
// confirmed the money actually arrived. The user's balance is credited,
// and if this is the user's first-ever approved deposit and they were
// referred by someone, that referrer earns a one-time commission (see
// the referral block below) - all inside the same DB transaction, so
// either everything succeeds together or none of it does.
//
// For withdrawals: approving means the admin has ALREADY sent the money to
// the user's Telebirr phone number and is now recording proof of that
// transfer (their own Telebirr reference) before the balance is debited.
router.post(
  '/transactions/:id/approve',
  [
    param('id').isUUID(),
    body('telebirr_reference').optional().trim().isLength({ max: 100 }).withMessage('Reference is too long'),
  ],
  handleValidation,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: txRows } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      const tx = txRows[0];
      if (!tx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found' });
      }
      if (tx.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Transaction is not pending' });
      }

      const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [tx.user_id]);
      const user = userRows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Associated user not found' });
      }

      const providedRef = (req.body.telebirr_reference || '').trim();
      if (!providedRef) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error:
            tx.type === 'deposit'
              ? 'Enter the Telebirr reference you verified in the business account before approving'
              : 'Enter the Telebirr reference for the transfer you sent before approving',
        });
      }

      // Hoisted so it's visible below, after the deposit/withdraw branch
      // closes - tracks whether a referral commission was paid to a
      // different user in this same approval, so we know to push a
      // balance update to them too, not just the depositor.
      let referrerIdToNotify = null;

      if (tx.type === 'deposit') {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [tx.amount, user.id]);

        // ------------------------------------------------------------
        // Referral commission: 5% (or whatever's configured) of a
        // referred user's FIRST-EVER approved deposit, paid to whoever
        // referred them. Guarded by referral_commission_paid so it can
        // never fire twice for the same referred user.
        // ------------------------------------------------------------
        const { rows: depositorRows } = await client.query(
          'SELECT referred_by, referral_commission_paid FROM users WHERE id = $1',
          [user.id]
        );
        const depositor = depositorRows[0];

        if (depositor?.referred_by && !depositor.referral_commission_paid) {
          const { rows: priorDepositsRows } = await client.query(
            `SELECT COUNT(*)::int AS count FROM transactions
             WHERE user_id = $1 AND type = 'deposit' AND status = 'approved' AND id != $2`,
            [user.id, tx.id]
          );
          const isFirstDeposit = priorDepositsRows[0].count === 0;

          if (isFirstDeposit) {
            const { rows: settingRows } = await client.query(
              `SELECT value FROM platform_settings WHERE key = 'referral_commission_percent'`
            );
            const commissionPercent = parseFloat(settingRows[0]?.value || '5');
            const commissionCents = Math.round(tx.amount * (commissionPercent / 100));

            if (commissionCents > 0) {
              await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [
                commissionCents,
                depositor.referred_by,
              ]);
              await client.query(
                `INSERT INTO transactions (user_id, type, amount, status, note)
                 VALUES ($1, 'payout', $2, 'completed', $3)`,
                [depositor.referred_by, commissionCents, `Referral commission (${commissionPercent}%)`]
              );
              await client.query('UPDATE users SET referral_commission_paid = TRUE WHERE id = $1', [user.id]);
              referrerIdToNotify = depositor.referred_by;
            }
          }
        }
      } else if (tx.type === 'withdraw') {
        if (user.balance < tx.amount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'User no longer has sufficient balance for this withdrawal' });
        }
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [tx.amount, user.id]);
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only deposit/withdraw transactions can be approved here' });
      }

      const { rows: updatedTxRows } = await client.query(
        `UPDATE transactions
         SET status = 'approved', approved_by = $1, telebirr_reference_admin = $2
         WHERE id = $3 RETURNING *`,
        [req.user.id, providedRef, tx.id]
      );

      const { rows: finalUserRows } = await client.query('SELECT balance FROM users WHERE id = $1', [user.id]);

      await client.query('COMMIT');

      // Push the fresh balance straight to this user's wallet page over
      // the socket - they see it the moment it's approved, not up to 10s
      // later on the next poll. Best-effort: if their socket isn't
      // connected right now, the existing poll still picks it up.
      pushBalanceUpdate(user.id);
      if (referrerIdToNotify) {
        // The referrer's balance may also have just changed (commission
        // payout above) - push their wallet too, not just the depositor's.
        pushBalanceUpdate(referrerIdToNotify);
      }

      logger.info('Admin approved transaction', {
        admin: req.user.username,
        txId: tx.id,
        type: tx.type,
        amount: tx.amount / 100,
        user: user.username,
        telebirr_reference_admin: providedRef,
      });

      res.json({
        message: 'Transaction approved',
        transaction: updatedTxRows[0],
        newBalance: finalUserRows[0].balance / 100,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// POST /api/admin/transactions/:id/reject
router.post(
  '/transactions/:id/reject',
  [param('id').isUUID(), body('reason').optional().isString().isLength({ max: 500 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const { rows: txRows } = await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
      const tx = txRows[0];
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

      const newNote = req.body.reason
        ? `${tx.note ? tx.note + ' | ' : ''}Rejected: ${req.body.reason}`
        : tx.note;

      const { rows } = await query(
        `UPDATE transactions SET status = 'rejected', approved_by = $1, note = $2 WHERE id = $3 RETURNING *`,
        [req.user.id, newNote, tx.id]
      );

      logger.info('Admin rejected transaction', {
        admin: req.user.username,
        txId: tx.id,
        type: tx.type,
        reason: req.body.reason || null,
      });

      res.json({ message: 'Transaction rejected', transaction: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  Platform settings - game logo                                       */
/* ------------------------------------------------------------------ */

// PUT /api/admin/settings/game-logo
// Admin sets the URL of an already-hosted image to use as the Buna Games
// logo shown to players. This does NOT handle file upload itself -
// it just stores a URL string. Upload your image to any static host
// (Supabase Storage, Cloudinary, imgur, etc.) first, then paste the
// resulting URL here.
router.put(
  '/settings/game-logo',
  [body('url').isURL().withMessage('A valid image URL is required')],
  handleValidation,
  async (req, res, next) => {
    try {
      await query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('game_logo_url', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [req.body.url]
      );

      logger.info('Admin updated game logo', { admin: req.user.username, url: req.body.url });

      res.json({ message: 'Game logo updated', url: req.body.url });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/admin/settings
// Returns every adjustable platform setting the admin panel exposes, with
// sensible defaults filled in for any key that's never been explicitly
// set yet (matching the same defaults the rest of the backend already
// falls back to - e.g. auth.js defaults signup_bonus_birr to 10 if this
// row doesn't exist).
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT key, value FROM platform_settings
       WHERE key IN ('signup_bonus_birr', 'referral_commission_percent', 'bingo_stake_birr', 'bingo_platform_fee_birr', 'game_logo_url')`
    );
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    res.json({
      signup_bonus_birr: parseFloat(settings.signup_bonus_birr ?? '10'),
      referral_commission_percent: parseFloat(settings.referral_commission_percent ?? '5'),
      bingo_stake_birr: parseFloat(settings.bingo_stake_birr ?? '10'),
      bingo_platform_fee_birr: parseFloat(settings.bingo_platform_fee_birr ?? '2'),
      game_logo_url: settings.game_logo_url || null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/settings/signup-bonus
// Adjusts the ETB amount granted as a locked bonus_balance on signup (see
// auth.js, which reads this same platform_settings key). 0 is a valid
// value - it disables the signup bonus entirely (auth.js already skips
// granting anything when bonusCents <= 0). This ONLY affects future
// signups; anyone who already received a bonus keeps what they were
// already granted, unchanged.
router.put(
  '/settings/signup-bonus',
  [body('amount').isFloat({ min: 0, max: 100000 }).withMessage('Amount must be 0 or a positive number')],
  handleValidation,
  async (req, res, next) => {
    try {
      const amount = parseFloat(req.body.amount);
      await query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('signup_bonus_birr', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [String(amount)]
      );

      logger.info('Admin updated signup bonus', { admin: req.user.username, amount });

      res.json({ message: 'Signup bonus updated', signup_bonus_birr: amount });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/admin/settings/bingo-fee
// Adjusts the per-cartela stake and the platform's cut of it. bingo.js
// reads both of these fresh from platform_settings at the start of every
// new round (see getBingoPricing() there), so a change here takes effect
// starting with the NEXT round that opens - it does not alter a round
// that's already in progress or already finished.
router.put(
  '/settings/bingo-fee',
  [
    body('stake_amount').isFloat({ min: 1, max: 10000 }).withMessage('Stake amount must be a positive number'),
    body('platform_fee')
      .isFloat({ min: 0, max: 10000 })
      .withMessage('Platform fee must be 0 or a positive number')
      .custom((value, { req }) => {
        if (parseFloat(value) >= parseFloat(req.body.stake_amount)) {
          throw new Error('Platform fee must be less than the stake amount');
        }
        return true;
      }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const stakeAmount = parseFloat(req.body.stake_amount);
      const platformFee = parseFloat(req.body.platform_fee);

      await query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('bingo_stake_birr', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [String(stakeAmount)]
      );
      await query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('bingo_platform_fee_birr', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [String(platformFee)]
      );

      logger.info('Admin updated bingo pricing', { admin: req.user.username, stakeAmount, platformFee });

      res.json({
        message: 'Bingo pricing updated. Takes effect starting with the next round.',
        bingo_stake_birr: stakeAmount,
        bingo_platform_fee_birr: platformFee,
      });
    } catch (err) {
      next(err);
    }
  }
);



// GET /api/admin/stats/overview
// Real aggregate numbers for the admin dashboard: total registered users,
// total deposited (approved deposits only), total withdrawn (approved
// withdrawals only), total amount users have won (sum of all 'payout'
// transactions), and total platform result (net of all bets minus all
// payouts - positive means the house is ahead, negative means users are
// net winners overall).
router.get('/stats/overview', async (req, res, next) => {
  try {
    const [usersRes, depositsRes, withdrawalsRes, betsRes, payoutsRes, bingoRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM users'),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'deposit' AND status = 'approved'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'withdraw' AND status = 'approved'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'bet' AND status = 'completed'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'payout' AND status = 'completed'`),
      // Bingo platform earnings: for rounds where someone won, this is
      // just the per-cartela fee collected (platform_earnings). For
      // rounds where nobody won, the platform additionally keeps the
      // entire pot (winner_payout is 0 in that case, so total_pot -
      // winner_payout correctly adds the rest on top of the fee).
      query(
        `SELECT COALESCE(SUM(total_pot - winner_payout), 0)::bigint AS total
         FROM bingo_rounds WHERE status = 'finished'`
      ),
    ]);

    const totalBets = betsRes.rows[0].total;
    const totalPayouts = payoutsRes.rows[0].total;

    res.json({
      totalUsers: usersRes.rows[0].count,
      totalDeposited: Number(depositsRes.rows[0].total) / 100,
      totalWithdrawn: Number(withdrawalsRes.rows[0].total) / 100,
      totalUserWinnings: Number(totalPayouts) / 100,
      platformResult: (Number(totalBets) - Number(totalPayouts)) / 100,
      bingoPlatformEarnings: Number(bingoRes.rows[0].total) / 100,
      onlineUsers: getOnlineUserCount(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/users
// Per-user list with registration info and their own total winnings
// (sum of their 'payout' transactions). Optional `search` matches
// against username or Telegram first name (case-insensitive, partial).
router.get('/stats/users', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const params = [];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = `WHERE u.username ILIKE $${params.length} OR u.telegram_first_name ILIKE $${params.length}`;
    }

    const listParams = [...params, limit, offset];
    const { rows } = await query(
      `SELECT
         u.id,
         u.username,
         u.telegram_first_name,
         u.balance,
         u.is_active,
         u.created_at,
         COALESCE(w.total_won, 0) AS total_won
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(amount) AS total_won
         FROM transactions
         WHERE type = 'payout' AND status = 'completed'
         GROUP BY user_id
       ) w ON w.user_id = u.id
       ${searchClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS count FROM users u ${searchClause}`,
      params
    );

    res.json({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        telegram_first_name: u.telegram_first_name,
        balance: u.balance / 100,
        totalWon: Number(u.total_won) / 100,
        isActive: u.is_active,
        created_at: u.created_at,
      })),
      page,
      totalPages: Math.ceil(countRows[0].count / limit),
      total: countRows[0].count,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Image upload (Supabase Storage) - used by the broadcast composer    */
/* ------------------------------------------------------------------ */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed'));
    }
    cb(null, true);
  },
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.error(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set - broadcast image upload will fail on every request until these are configured'
  );
}

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// POST /api/admin/upload-image
// Accepts a single image file (multipart/form-data, field name "image"),
// uploads it to the "broadcast-images" bucket in Supabase Storage, and
// returns its public URL. Used by the broadcast composer to attach a
// photo to a message before sending.
router.post('/upload-image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file was uploaded' });
    }

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('broadcast-images')
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
      });

    if (uploadError) {
      logger.error('Supabase Storage upload failed', { error: uploadError.message });
      // Surface the real cause (wrong/missing bucket, bad credentials, RLS
      // policy, etc.) instead of a generic message - a silent generic
      // error here is exactly what made this bug impossible to diagnose
      // from the admin UI before.
      return res.status(500).json({ error: `Image upload failed: ${uploadError.message}` });
    }

    const { data: publicUrlData } = supabaseAdmin.storage.from('broadcast-images').getPublicUrl(filename);

    logger.info('Admin uploaded broadcast image', { admin: req.user.username, filename });

    res.status(201).json({ url: publicUrlData.publicUrl });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Broadcast - send a message (optionally with an image + button) to   */
/*  every active user who has started the bot                           */
/* ------------------------------------------------------------------ */

const broadcastValidation = [
  body('message').isString().trim().isLength({ min: 1, max: 1024 }).withMessage('Message is required'),
  body('button_text').optional({ nullable: true }).isString().trim().isLength({ max: 60 }),
  body('button_url').optional({ nullable: true }).isURL().withMessage('Button URL must be a valid link'),
  body('image_url').optional({ nullable: true }).isURL().withMessage('Image URL must be a valid link'),
];

// POST /api/admin/broadcast
// Sends `message` to every user with a stored telegram_chat_id. If
// `image_url` is provided (from the upload-image endpoint above), sends
// it as a photo with `message` as the caption instead of a plain text
// message. Telegram's photo captions are capped at 1024 characters,
// hence the shorter max length above (vs 4000 for plain text messages).
// Sends happen one at a time with a small delay to stay well under
// Telegram's rate limits. The response returns immediately with a
// broadcast ID; the final tally (successes/failures) is recorded in the
// `broadcasts` table once the background send loop finishes.
router.post('/broadcast', broadcastValidation, handleValidation, async (req, res, next) => {
  try {
    const bot = getBotInstance();
    if (!bot) {
      return res.status(503).json({ error: 'The Telegram bot is not currently running' });
    }

    const { message, button_text, button_url, image_url } = req.body;

    const { rows: recipients } = await query(
      'SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND is_active = TRUE'
    );

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients found - no users have a stored Telegram chat ID yet' });
    }

    const { rows: broadcastRows } = await query(
      `INSERT INTO broadcasts (sent_by, message, button_text, button_url, image_url, total_recipients)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, message, button_text || null, button_url || null, image_url || null, recipients.length]
    );
    const broadcastId = broadcastRows[0].id;

    // Respond immediately - don't make the admin's request hang for
    // however long it takes to message every single user.
    res.status(202).json({
      message: 'Broadcast started',
      broadcastId,
      totalRecipients: recipients.length,
    });

    // Send in the background. Errors for individual users (e.g. they
    // blocked the bot) are caught per-message so one failure doesn't
    // stop the rest of the broadcast.
    (async () => {
      let successCount = 0;
      let failCount = 0;

      const replyMarkup =
        button_text && button_url
          ? { inline_keyboard: [[{ text: button_text, url: button_url }]] }
          : undefined;

      for (const recipient of recipients) {
        try {
          if (image_url) {
            // Fetch the image bytes ourselves (server-to-server fetch is
            // reliable) and hand Telegram a Buffer directly, instead of a
            // bare URL. Telegram's own URL-fetcher is picky about
            // content-type headers and occasionally rejects perfectly
            // valid image URLs with "wrong type of the web page content"
            // or "failed to get HTTP URL content" - sending raw bytes
            // sidesteps that step entirely.
            const imageResponse = await fetch(image_url);
            if (!imageResponse.ok) {
              throw new Error(`Could not fetch image for sending: ${imageResponse.status}`);
            }
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

            await bot.sendPhoto(recipient.telegram_chat_id, imageBuffer, {
              caption: message,
              reply_markup: replyMarkup,
            });
          } else {
            await bot.sendMessage(recipient.telegram_chat_id, message, {
              reply_markup: replyMarkup,
            });
          }
          successCount++;
        } catch (err) {
          failCount++;
          logger.warn('[broadcast] Failed to send to user', {
            userId: recipient.id,
            error: err.message,
          });
        }
        // Small delay between sends to stay comfortably under Telegram's
        // rate limits for a large recipient list.
        await new Promise((resolve) => setTimeout(resolve, 40));
      }

      await query(
        'UPDATE broadcasts SET successful_sends = $1, failed_sends = $2 WHERE id = $3',
        [successCount, failCount, broadcastId]
      );

      logger.info('[broadcast] Completed', { broadcastId, successCount, failCount });
    })().catch((err) => {
      logger.error('[broadcast] Background send loop crashed', { error: err.message });
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/broadcast/history - past broadcasts, for the admin to
// review what was sent and how it went.
router.get('/broadcast/history', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, u.username AS sent_by_username
       FROM broadcasts b
       LEFT JOIN users u ON u.id = b.sent_by
       ORDER BY b.created_at DESC
       LIMIT 20`
    );
    res.json({
      broadcasts: rows.map((b) => ({
        id: b.id,
        message: b.message,
        buttonText: b.button_text,
        buttonUrl: b.button_url,
        imageUrl: b.image_url,
        totalRecipients: b.total_recipients,
        successfulSends: b.successful_sends,
        failedSends: b.failed_sends,
        sentBy: b.sent_by_username,
        created_at: b.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
