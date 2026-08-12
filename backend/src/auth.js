const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { query, pool } = require('./database');
const { getBotInstance } = require('./bot');
const logger = require('./logger');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiting                                                       */
/* ------------------------------------------------------------------ */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

/* ------------------------------------------------------------------ */
/*  Token helpers                                                       */
/* ------------------------------------------------------------------ */

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/* ------------------------------------------------------------------ */
/*  Referral code generation                                            */
/*  Generates a short, URL-safe referral code and retries on the rare   */
/*  collision (checked against the database) rather than trusting       */
/*  randomness alone to be unique.                                      */
/* ------------------------------------------------------------------ */

async function generateUniqueReferralCode(queryFn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    const { rows } = await queryFn('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  // Extremely unlikely to ever reach here, but fail safe with a
  // timestamp-based fallback that's guaranteed unique.
  return `t${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/*  Telegram Web App initData verification                              */
/*                                                                        */
/*  Telegram signs the data it hands to your Mini App using an HMAC       */
/*  derived from your bot token. We MUST verify this signature server-    */
/*  side before trusting any user info in it - otherwise anyone could     */
/*  forge a fake Telegram identity and register/log in as anyone.         */
/*  Reference: https://core.telegram.org/bots/webapps#validating-data-    */
/*  received-via-the-mini-app                                             */
/* ------------------------------------------------------------------ */

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false, data: null };

  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const valid = computedHash === hash;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const isFresh = authDate > 0 && Date.now() / 1000 - authDate < 60 * 60 * 24;

  if (!valid || !isFresh) return { valid: false, data: null };

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }

  return { valid: true, data: { user, authDate } };
}

/* ------------------------------------------------------------------ */
/*  Middleware (exported for use by other route files)                  */
/* ------------------------------------------------------------------ */

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { rows } = await query(
      'SELECT id, username, role, balance, bonus_balance, wagering_required, wagering_target_total, channels_verified, bot_link_clicked, is_active, telegram_id, telegram_first_name, telegram_photo_url, telegram_phone, referral_code FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

const telegramAuthValidation = [
  body('initData').isString().notEmpty().withMessage('Telegram initData is required'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

// POST /api/auth/telegram - the only login/registration path.
// The frontend, running inside Telegram's Mini App webview, sends the raw
// initData string it received from the Telegram Web App SDK, plus
// (optionally) a referral_code if the bot was opened via a referral deep
// link. We verify initData's signature server-side, then find-or-create
// the matching user and issue our own JWT.
router.post('/telegram', authLimiter, telegramAuthValidation, handleValidation, async (req, res, next) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'Server is not configured for Telegram auth' });
    }

    const { valid, data } = verifyTelegramInitData(req.body.initData, botToken);
    if (!valid || !data?.user?.id) {
      return res.status(401).json({ error: 'Invalid or expired Telegram authentication data' });
    }

    const tgUser = data.user;
    const telegramId = tgUser.id;

    let { rows } = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    let user = rows[0];

    if (!user) {
      // First time we've seen this Telegram user - create an account.
      const baseUsername = tgUser.username || `${tgUser.first_name || 'player'}${telegramId}`.replace(/\s+/g, '');
      let username = baseUsername.slice(0, 30);

      const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.length > 0) {
        username = `${username}_${telegramId}`.slice(0, 30);
      }

      const insertRes = await query(
        `INSERT INTO users (username, role, balance, telegram_id, telegram_username, telegram_first_name, telegram_photo_url)
         VALUES ($1, 'user', 0, $2, $3, $4, $5)
         RETURNING *`,
        [username, telegramId, tgUser.username || null, tgUser.first_name || null, tgUser.photo_url || null]
      );
      user = insertRes.rows[0];

      // ------------------------------------------------------------
      // Signup bonus: credit a one-time bonus (default 10 birr, or
      // whatever's configured in platform_settings), guarded so it can
      // never be granted twice even under a retried/duplicate request.
      //
      // The bonus is credited to bonus_balance (NOT balance) and is
      // locked behind a wagering requirement (100x the bonus amount,
      // i.e. wagering_required starts at bonusCents * 100). It only
      // becomes withdrawable once wagering_required reaches 0 - see
      // the WAGERING_MULTIPLIER TODO below and wallet.js's withdraw
      // route, which blocks withdrawal while wagering_required > 0.
      // ------------------------------------------------------------
      const WAGERING_MULTIPLIER = 100;
      try {
        const { rows: settingRows } = await query(
          `SELECT value FROM platform_settings WHERE key = 'signup_bonus_birr'`
        );
        const bonusBirr = parseFloat(settingRows[0]?.value || '10');
        const bonusCents = Math.round(bonusBirr * 100);

        if (bonusCents > 0) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            const { rows: lockedUserRows } = await client.query(
              'SELECT signup_bonus_granted FROM users WHERE id = $1 FOR UPDATE',
              [user.id]
            );
            const alreadyGranted = lockedUserRows[0]?.signup_bonus_granted;

            if (!alreadyGranted) {
              const wageringRequiredCents = bonusCents * WAGERING_MULTIPLIER;
              await client.query(
                `UPDATE users
                 SET bonus_balance = bonus_balance + $1,
                     wagering_required = wagering_required + $2,
                     wagering_target_total = wagering_target_total + $2,
                     signup_bonus_granted = TRUE
                 WHERE id = $3`,
                [bonusCents, wageringRequiredCents, user.id]
              );
              await client.query(
                `INSERT INTO transactions (user_id, type, amount, status, note)
                 VALUES ($1, 'payout', $2, 'completed', 'Registration bonus (locked - wagering required)')`,
                [user.id, bonusCents]
              );
              user.bonus_balance = (user.bonus_balance || 0) + bonusCents;
              user.wagering_required = (user.wagering_required || 0) + wageringRequiredCents;
              user.wagering_target_total = (user.wagering_target_total || 0) + wageringRequiredCents;
            }

            await client.query('COMMIT');
          } catch (bonusErr) {
            await client.query('ROLLBACK');
            console.error('[auth] Failed to grant signup bonus', { userId: user.id, error: bonusErr.message });
          } finally {
            client.release();
          }
        }
      } catch (err) {
        console.error('[auth] Signup bonus lookup failed', { error: err.message });
      }

      // ------------------------------------------------------------
      // Referral: generate this new user's own referral code, then (if
      // they arrived via someone else's referral link) link them to
      // that referrer. Referral tracking never blocks login - any
      // failure here is logged and swallowed, not surfaced as an error.
      // ------------------------------------------------------------
      try {
        const referralCode = await generateUniqueReferralCode(query);
        await query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, user.id]);
        user.referral_code = referralCode;

        const referralCodeUsed = req.body.referral_code;

        // TEMPORARY DEBUG LOG - remove once referral tracking is
        // confirmed working. Shows exactly what code (if any) arrived
        // in this signup request, before we even try to match it.
        console.log('[auth] New signup referral code received', {
          newUserId: user.id,
          referralCodeUsed: referralCodeUsed || null,
        });

        if (referralCodeUsed && typeof referralCodeUsed === 'string') {
          const { rows: referrerRows } = await query(
            'SELECT id FROM users WHERE referral_code = $1',
            [referralCodeUsed.trim()]
          );

          // TEMPORARY DEBUG LOG - remove once referral tracking is
          // confirmed working.
          console.log('[auth] Referral code lookup result', {
            referralCodeUsed: referralCodeUsed.trim(),
            matchFound: referrerRows.length > 0,
            referrerId: referrerRows[0]?.id || null,
          });

          if (referrerRows.length > 0 && referrerRows[0].id !== user.id) {
            await query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrerRows[0].id, user.id]);
          }
        }
      } catch (err) {
        console.error('[auth] Referral setup failed', { userId: user.id, error: err.message });
      }

      // If they shared their phone number with the bot before opening the
      // Mini App (via the /start flow), attach it now and clean up the
      // staging row.
      const { rows: pendingPhone } = await query(
        'SELECT phone FROM pending_telegram_phones WHERE telegram_id = $1',
        [telegramId]
      );
      if (pendingPhone.length > 0) {
        await query('UPDATE users SET telegram_phone = $1 WHERE id = $2', [pendingPhone[0].phone, user.id]);
        await query('DELETE FROM pending_telegram_phones WHERE telegram_id = $1', [telegramId]);
        user.telegram_phone = pendingPhone[0].phone;
      }
    } else {
      // Existing user - refresh their cached Telegram profile info in case
      // they changed their username/name/photo since last login.
      await query(
        `UPDATE users SET telegram_username = $1, telegram_first_name = $2, telegram_photo_url = $3 WHERE id = $4`,
        [tgUser.username || null, tgUser.first_name || null, tgUser.photo_url || null, user.id]
      );
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        balance: user.balance,
        bonus_balance: user.bonus_balance || 0,
        wagering_required: user.wagering_required || 0,
        wagering_target_total: user.wagering_target_total || 0,
        channels_verified: user.channels_verified || false,
        bot_link_clicked: user.bot_link_clicked || false,
        telegram_first_name: tgUser.first_name || user.telegram_first_name,
        telegram_photo_url: tgUser.photo_url || user.telegram_photo_url,
        telegram_phone: user.telegram_phone || null,
        referral_code: user.referral_code || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      balance: req.user.balance,
      bonus_balance: req.user.bonus_balance || 0,
      wagering_required: req.user.wagering_required || 0,
      wagering_target_total: req.user.wagering_target_total || 0,
      channels_verified: req.user.channels_verified || false,
      bot_link_clicked: req.user.bot_link_clicked || false,
      telegram_first_name: req.user.telegram_first_name,
      telegram_photo_url: req.user.telegram_photo_url,
      telegram_phone: req.user.telegram_phone,
      referral_code: req.user.referral_code,
    },
  });
});

// GET /api/auth/verify-channels
//
// Checks (for real, via Telegram's own API - not just trusting a button
// click) whether the current user is a member of both the required
// channel and group. Requires the bot to be an admin in both chats,
// since getChatMember only works for chats the bot itself belongs to.
//
// REQUIRED_CHANNEL_ID / REQUIRED_GROUP_ID can be set to either a
// numeric chat id or a public @username (e.g. "@buna_games_best") -
// Telegram's getChatMember accepts both formats for channels and
// supergroups.
//
// On success, sets channels_verified = TRUE permanently - this is a
// one-time gate, not re-checked on future logins even if the user later
// leaves. On failure, tells the frontend which chat(s) are still missing
// so it can show a precise message instead of a generic "not verified".
const REQUIRED_CHANNELS = [
  { id: process.env.REQUIRED_CHANNEL_ID, label: 'channel' },
  { id: process.env.REQUIRED_GROUP_ID, label: 'group' },
];

// Flat one-time bonus paid to a REFERRER when someone they invited
// completes channel/group verification - separate from, and paid
// independently of, the 5% deposit commission in admin.js. A user only
// ever triggers this once (guarded by referral_join_bonus_paid on the
// invited user's own row), regardless of how many times they might
// re-request /verify-channels.
const REFERRAL_JOIN_BONUS_BIRR = 10;

router.get('/verify-channels', requireAuth, async (req, res, next) => {
  if (req.user.channels_verified) {
    // Channel/group were already confirmed (possibly before the Argo
    // step existed) - the only remaining gate is the honor-system bot
    // link tap, which needs no Telegram API call.
    if (!req.user.bot_link_clicked) {
      return res.json({ verified: false, missing: ['bot_link'] });
    }
    return res.json({ verified: true, missing: [] });
  }

  const bot = getBotInstance();
  if (!bot) {
    return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again shortly.' });
  }

  const missing = [];
  for (const target of REQUIRED_CHANNELS) {
    if (!target.id) {
      // Not configured - treat as missing rather than silently passing,
      // so a missing env var fails loudly instead of granting access
      // nobody actually checked.
      missing.push(target.label);
      continue;
    }
    try {
      const member = await bot.getChatMember(target.id, req.user.telegram_id);
      const validStatuses = ['creator', 'administrator', 'member'];
      if (!validStatuses.includes(member.status)) {
        missing.push(target.label);
      }
    } catch (err) {
      // getChatMember throws if the user was never in the chat, or if
      // the bot itself lacks access - either way, they haven't
      // verified successfully.
      logger.warn('[auth] getChatMember check failed', { chat: target.id, error: err.message });
      missing.push(target.label);
    }
  }

  if (!req.user.bot_link_clicked) {
    missing.push('bot_link');
  }

  if (missing.length > 0) {
    return res.json({ verified: false, missing });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: selfRows } = await client.query(
      'SELECT referred_by, referral_join_bonus_paid FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const self = selfRows[0];

    await client.query('UPDATE users SET channels_verified = TRUE WHERE id = $1', [req.user.id]);

    if (self?.referred_by && !self.referral_join_bonus_paid) {
      const bonusCents = Math.round(REFERRAL_JOIN_BONUS_BIRR * 100);

      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [
        bonusCents,
        self.referred_by,
      ]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, 'payout', $2, 'completed', $3)`,
        [self.referred_by, bonusCents, 'Referral join bonus']
      );
      await client.query('UPDATE users SET referral_join_bonus_paid = TRUE WHERE id = $1', [req.user.id]);

      logger.info('[auth] Paid referral join bonus', {
        referrerId: self.referred_by,
        invitedUserId: req.user.id,
        amount: REFERRAL_JOIN_BONUS_BIRR,
      });
    }

    await client.query('COMMIT');

    res.json({ verified: true, missing: [] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/auth/mark-bot-link-clicked
//
// Records that the user tapped the third-party (Argo) bot link. This is
// an honor-system flag, not a real check - see the comment on
// bot_link_clicked's migration for why Telegram's API can't verify this
// for a bot we don't own. Idempotent: calling it again once already
// true is a harmless no-op.
router.post('/mark-bot-link-clicked', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE users SET bot_link_clicked = TRUE WHERE id = $1', [req.user.id]);
    res.json({ bot_link_clicked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, requireAuth, requireAdmin, signToken, verifyToken };
