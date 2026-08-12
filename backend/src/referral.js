const express = require('express');
const { query } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

// Percentage of a referred user's total wagered amount that shows up as
// this referrer's "GGR Amount". Deliberately not sent to the client in
// any form - only the already-multiplied ETB figure is returned, so the
// rate itself never appears in a response payload or on screen.
const GGR_SHARE_PERCENT = 5;

/* ------------------------------------------------------------------ */
/*  GET /api/referral/stats                                            */
/*                                                                       */
/*  Returns the current user's referral link ingredients plus stats     */
/*  for the profile/referral pages:                                     */
/*    - referred_count: how many users signed up with referred_by       */
/*      pointing at this user (regardless of whether they've deposited  */
/*      yet).                                                           */
/*    - total_commission: sum of every 'payout' transaction this user   */
/*      has received whose note starts with 'Referral commission' -     */
/*      i.e. the actual commission payouts credited by admin.js's       */
/*      deposit-approval flow, not a computed/estimated figure.         */
/*    - total_ggr: GGR_SHARE_PERCENT of the total amount WAGERED (sum    */
/*      of 'bet' transactions) by every user this person referred. The   */
/*      raw wagered total and the percentage itself are intentionally   */
/*      never returned - only this already-reduced figure is.           */
/* ------------------------------------------------------------------ */
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const [countRes, commissionRes, wageredRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [req.user.id]),
      query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
         FROM transactions
         WHERE user_id = $1 AND type = 'payout' AND status = 'completed' AND note LIKE 'Referral commission%'`,
        [req.user.id]
      ),
      query(
        `SELECT COALESCE(SUM(t.amount), 0)::bigint AS total
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE u.referred_by = $1 AND t.type = 'bet' AND t.status = 'completed'`,
        [req.user.id]
      ),
    ]);

    const totalWageredCents = Number(wageredRes.rows[0].total);
    const ggrCents = Math.round(totalWageredCents * (GGR_SHARE_PERCENT / 100));

    res.json({
      referred_count: countRes.rows[0].count,
      total_commission: Number(commissionRes.rows[0].total) / 100,
      total_ggr: ggrCents / 100,
      referral_code: req.user.referral_code || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
