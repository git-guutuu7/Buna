const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query, pool } = require('./database');
const { requireAuth, requireAdmin } = require('./auth');
const logger = require('./logger');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

const WINDOW_TO_INTERVAL = {
  today: "date_trunc('day', now())",
  week: "now() - interval '7 days'",
  month: "now() - interval '30 days'",
  year: "now() - interval '365 days'",
};

/* ==================================================================== */
/*  Admin: create / list / manage coupons                                */
/* ==================================================================== */

const createCouponValidation = [
  body('code').isString().trim().isLength({ min: 3, max: 40 }).withMessage('Code must be 3-40 characters'),
  body('type').isIn(['free', 'deposit_gated']).withMessage('Type must be free or deposit_gated'),
  body('amount').isFloat({ gt: 0, max: 1000000 }).withMessage('Amount must be a positive number'),
  body('maxClaims').isInt({ gt: 0, max: 1000000 }).withMessage('Max claims must be a positive whole number'),
  body('depositWindow')
    .if(body('type').equals('deposit_gated'))
    .isIn(['today', 'week', 'month', 'year'])
    .withMessage('Deposit window is required for deposit-gated coupons'),
  body('minDeposit')
    .if(body('type').equals('deposit_gated'))
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage('Minimum deposit is required for deposit-gated coupons'),
  body('requireFirstDeposit').optional().isBoolean(),
  body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('Expiry must be a valid date'),
];

// POST /api/coupons/admin - create a new coupon
router.post('/admin', requireAuth, requireAdmin, createCouponValidation, handleValidation, async (req, res, next) => {
  try {
    const code = req.body.code.trim().toUpperCase();
    const amountCents = Math.round(Number(req.body.amount) * 100);
    const minDepositCents = req.body.minDeposit ? Math.round(Number(req.body.minDeposit) * 100) : null;

    const { rows } = await query(
      `INSERT INTO coupons
         (code, type, amount_cents, max_claims, deposit_window, min_deposit_cents, require_first_deposit, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        code,
        req.body.type,
        amountCents,
        req.body.maxClaims,
        req.body.type === 'deposit_gated' ? req.body.depositWindow : null,
        minDepositCents,
        Boolean(req.body.requireFirstDeposit),
        req.body.expiresAt || null,
        req.user.id,
      ]
    );

    logger.info('Admin created coupon', { admin: req.user.username, code });

    res.status(201).json({ message: 'Coupon created', coupon: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A coupon with that code already exists' });
    }
    next(err);
  }
});

// GET /api/coupons/admin - list all coupons with their redemption counts
router.get('/admin', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, COUNT(r.id)::int AS claims_used
       FROM coupons c
       LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );

    res.json({
      coupons: rows.map((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        amount: c.amount_cents / 100,
        maxClaims: c.max_claims,
        claimsUsed: c.claims_used,
        depositWindow: c.deposit_window,
        minDeposit: c.min_deposit_cents ? c.min_deposit_cents / 100 : null,
        requireFirstDeposit: c.require_first_deposit,
        active: c.active,
        expiresAt: c.expires_at,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/coupons/admin/:id/active - pause/release a coupon
router.patch(
  '/admin/:id/active',
  requireAuth,
  requireAdmin,
  [param('id').isUUID(), body('active').isBoolean()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { rows } = await query('UPDATE coupons SET active = $1 WHERE id = $2 RETURNING id, code, active', [
        req.body.active,
        req.params.id,
      ]);
      if (!rows[0]) return res.status(404).json({ error: 'Coupon not found' });

      logger.info('Admin toggled coupon', { admin: req.user.username, code: rows[0].code, active: rows[0].active });

      res.json({ message: 'Coupon updated', coupon: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/* ==================================================================== */
/*  User: redeem a coupon                                                */
/* ==================================================================== */

// POST /api/coupons/redeem
router.post(
  '/redeem',
  requireAuth,
  [body('code').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Enter a coupon code')],
  handleValidation,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const code = req.body.code.trim().toUpperCase();

      const { rows: couponRows } = await client.query('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code]);
      const coupon = couponRows[0];
      if (!coupon) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Invalid coupon code' });
      }
      if (!coupon.active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This coupon is no longer active' });
      }
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This coupon has expired' });
      }

      const { rows: claimCountRows } = await client.query(
        'SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1',
        [coupon.id]
      );
      if (claimCountRows[0].count >= coupon.max_claims) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This coupon has reached its claim limit' });
      }

      const { rows: alreadyClaimedRows } = await client.query(
        'SELECT id FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2',
        [coupon.id, req.user.id]
      );
      if (alreadyClaimedRows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "You've already claimed this coupon" });
      }

      if (coupon.type === 'deposit_gated') {
        const sinceExpr = WINDOW_TO_INTERVAL[coupon.deposit_window];

        if (coupon.require_first_deposit) {
          // Must be the user's first-ever approved deposit, AND that
          // specific deposit must itself satisfy the window + minimum.
          const { rows: firstDepositRows } = await client.query(
            `SELECT * FROM transactions
             WHERE user_id = $1 AND type = 'deposit' AND status = 'approved'
             ORDER BY created_at ASC LIMIT 1`,
            [req.user.id]
          );
          const firstDeposit = firstDepositRows[0];

          let qualifies = false;
          if (firstDeposit) {
            const checkParams = [firstDeposit.id];
            let checkClause = `id = $1 AND created_at >= ${sinceExpr}`;
            if (coupon.min_deposit_cents) {
              checkParams.push(coupon.min_deposit_cents);
              checkClause += ` AND amount >= $${checkParams.length}`;
            }
            const { rows: checkRows } = await client.query(
              `SELECT 1 FROM transactions WHERE ${checkClause}`,
              checkParams
            );
            qualifies = checkRows.length > 0;
          }

          if (!qualifies) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: "This coupon requires a qualifying first deposit that you don't have yet",
            });
          }
        } else {
          const params = [req.user.id];
          let clause = `user_id = $1 AND type = 'deposit' AND status = 'approved' AND created_at >= ${sinceExpr}`;
          if (coupon.min_deposit_cents) {
            params.push(coupon.min_deposit_cents);
            clause += ` AND amount >= $${params.length}`;
          }
          const { rows: qualifyingDepositRows } = await client.query(
            `SELECT 1 FROM transactions WHERE ${clause} LIMIT 1`,
            params
          );
          if (qualifyingDepositRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: "This coupon requires a qualifying deposit that you don't have yet",
            });
          }
        }
      }

      await client.query('INSERT INTO coupon_redemptions (coupon_id, user_id, amount_cents) VALUES ($1, $2, $3)', [
        coupon.id,
        req.user.id,
        coupon.amount_cents,
      ]);

      const { rows: updatedUserRows } = await client.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [coupon.amount_cents, req.user.id]
      );

      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, 'payout', $2, 'completed', $3)`,
        [req.user.id, coupon.amount_cents, `Coupon redeemed: ${coupon.code}`]
      );

      await client.query('COMMIT');

      logger.info('User redeemed coupon', {
        user: req.user.username,
        code: coupon.code,
        amount: coupon.amount_cents / 100,
      });

      res.json({
        message: 'Coupon redeemed',
        amount: coupon.amount_cents / 100,
        balance: updatedUserRows[0].balance / 100,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

module.exports = router;
