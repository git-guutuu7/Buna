const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { query } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiting for financial requests                                */
/* ------------------------------------------------------------------ */

const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many financial requests. Please try again later.' },
});

/* ------------------------------------------------------------------ */
/*  Validation                                                          */
/* ------------------------------------------------------------------ */

const MIN_DEPOSIT_BIRR = 10;
const MIN_WITHDRAW_BIRR = 200;

// Deposits: user must supply the Telebirr transaction reference they paid
// with, so the admin can cross-check it against the actual Telebirr
// business account before crediting the balance.
const depositValidation = [
  body('amount')
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage('Amount must be a positive number')
    .custom((value) => {
      if (parseFloat(value) < MIN_DEPOSIT_BIRR) {
        throw new Error(`Minimum deposit is ${MIN_DEPOSIT_BIRR} ETB`);
      }
      return true;
    }),
  body('telebirr_reference')
    .trim()
    .notEmpty()
    .withMessage('Telebirr transaction reference is required')
    .isLength({ max: 100 })
    .withMessage('Reference is too long'),
];

// Withdrawals: user must supply the Telebirr phone number funds should be
// sent to.
const withdrawValidation = [
  body('amount')
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage('Amount must be a positive number')
    .custom((value) => {
      if (parseFloat(value) < MIN_WITHDRAW_BIRR) {
        throw new Error(`Minimum withdrawal is ${MIN_WITHDRAW_BIRR} ETB`);
      }
      return true;
    }),
  body('telebirr_phone')
    .trim()
    .notEmpty()
    .withMessage('Telebirr phone number is required')
    .matches(/^\+?\d{9,15}$/)
    .withMessage('Enter a valid Telebirr phone number (digits only, optional leading +)'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/* ------------------------------------------------------------------ */
/*  Routes (all require authentication)                                 */
/* ------------------------------------------------------------------ */

// GET /api/wallet/balance
router.get('/balance', requireAuth, async (req, res) => {
  res.json({
    balance: req.user.balance / 100,
    bonus_balance: (req.user.bonus_balance || 0) / 100,
    wagering_required: (req.user.wagering_required || 0) / 100,
    wagering_target_total: (req.user.wagering_target_total || 0) / 100,
  });
});

// POST /api/wallet/deposit  -> creates a PENDING deposit request for admin review
router.post('/deposit', requireAuth, financialLimiter, depositValidation, handleValidation, async (req, res, next) => {
  try {
    const amountCents = toCents(req.body.amount);
    const reference = req.body.telebirr_reference.trim();

    const duplicate = await query(
      `SELECT id FROM transactions
       WHERE type = 'deposit' AND telebirr_reference_submitted = $1 AND status IN ('pending', 'approved')`,
      [reference]
    );
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: 'This Telebirr reference has already been submitted' });
    }

    const { rows } = await query(
      `INSERT INTO transactions (user_id, type, amount, status, note, telebirr_reference_submitted)
       VALUES ($1, 'deposit', $2, 'pending', $3, $4)
       RETURNING *`,
      [req.user.id, amountCents, (req.body.note || '').slice(0, 500), reference]
    );

    res.status(201).json({
      message: 'Deposit request submitted. An admin will verify your Telebirr payment and approve it shortly.',
      transaction: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/wallet/withdraw -> creates a PENDING withdrawal request for admin review
// Balance is NOT deducted until an admin approves (after actually sending the
// funds). We check the user currently has sufficient balance to cover it.
//
// Withdrawal is blocked while the user has an outstanding wagering
// requirement (from a bonus, e.g. the 10 ETB signup bonus) - the requirement
// is decremented elsewhere as the user wagers real bets. See auth.js for
// where wagering_required is set on signup bonus grant.
router.post('/withdraw', requireAuth, financialLimiter, withdrawValidation, handleValidation, async (req, res, next) => {
  try {
    const amountCents = toCents(req.body.amount);

    const { rows: userRows } = await query(
      'SELECT balance, wagering_required FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!userRows[0]) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    if (userRows[0].wagering_required > 0) {
      return res.status(400).json({
        error: `You still need to wager ${(userRows[0].wagering_required / 100).toFixed(2)} ETB before you can withdraw`,
      });
    }
    if (userRows[0].balance < amountCents) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const { rows } = await query(
      `INSERT INTO transactions (user_id, type, amount, status, note, telebirr_phone)
       VALUES ($1, 'withdraw', $2, 'pending', $3, $4)
       RETURNING *`,
      [req.user.id, amountCents, (req.body.note || '').slice(0, 500), req.body.telebirr_phone.trim()]
    );

    res.status(201).json({
      message: 'Withdrawal request submitted. An admin will send the funds via Telebirr and approve it shortly.',
      transaction: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/wallet/transactions -> the current user's own transaction history
router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (page - 1) * limit;

    const [itemsRes, countRes] = await Promise.all([
      query(
        `SELECT * FROM transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      query('SELECT COUNT(*)::int AS count FROM transactions WHERE user_id = $1', [req.user.id]),
    ]);

    const total = countRes.rows[0].count;

    res.json({
      transactions: itemsRes.rows.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
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

module.exports = router;
