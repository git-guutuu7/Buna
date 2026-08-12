const TelegramBot = require('node-telegram-bot-api');
const { query } = require('./database');
const logger = require('./logger');

// Runs the Telegram bot using long polling. Started once from server.js.
//
// Flow: /start -> bot asks the user to share their phone number via
// Telegram's native contact button -> once shared, we save it against
// their user record (or stage it if they don't have an account yet) and
// show the "Play Buna Games" button that opens the Mini App.
//
// Referral codes: a link like t.me/your_bot?start=REF_abc123 delivers
// "REF_abc123" as text AFTER "/start " in msg.text - NOT via Telegram's
// start_param mechanism, because that mechanism only works for Direct
// Link and Attachment Menu launches, not for the inline `web_app`-type
// button this bot uses to open the Mini App (Telegram Bot API
// limitation - inline web_app buttons only pass basic user info and a
// query_id, never a start parameter). So the code is captured here from
// the raw /start command, held in memory across the phone-share step,
// then appended as an ordinary `?ref=` query parameter on the Mini App
// button's URL - which Login.jsx reads from window.location.search.
//
// botInstance holds the running bot object once started, so other parts
// of the backend (admin.js's broadcast route) can reuse the SAME live
// connection to send messages, instead of creating a second bot
// connection or running into a circular import between bot.js and
// admin.js.
let botInstance = null;

// Referral codes captured from /start, keyed by telegram chat id, held
// only long enough to survive the phone-share step (a minute or two in
// practice). Not persisted to the database directly - auth.js is what
// actually links referred_by, using the code once it reaches it via the
// Mini App URL.
const pendingReferralCodes = new Map();

function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const miniAppUrl = process.env.MINI_APP_URL;

  if (!token) {
    logger.warn('[bot] TELEGRAM_BOT_TOKEN not set - Telegram bot will not start');
    return null;
  }
  if (!miniAppUrl) {
    logger.warn('[bot] MINI_APP_URL not set - the Mini App button will not work');
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'there';
    const referralCode = match && match[1] ? match[1].trim() : null;

    if (referralCode) {
      pendingReferralCodes.set(chatId, referralCode);
    }

    bot.sendMessage(
      chatId,
      `Welcome to Buna Games, ${firstName}!\n\n` +
        `To get started, please share your phone number. We use this for withdrawals.`,
      {
        reply_markup: {
          keyboard: [
            [
              {
                text: 'Share my phone number',
                request_contact: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  });

  // Fires when the user taps the "Share my phone number" button above.
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const phone = msg.contact.phone_number;

    // Only accept a contact the user shared about themselves, not someone
    // else's contact card they might have forwarded.
    if (msg.contact.user_id !== telegramId) {
      bot.sendMessage(chatId, 'Please share your own phone number using the button provided.');
      return;
    }

    try {
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      const { rows } = await query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);

      if (rows.length > 0) {
        // This is the ONLY place telegram_chat_id gets captured - it's not
        // available from the Mini App's initData (auth.js), only from an
        // actual bot conversation like this one, so this update is the
        // sole source of truth for it on an existing account.
        await query('UPDATE users SET telegram_phone = $1, telegram_chat_id = $2 WHERE telegram_id = $3', [
          normalizedPhone,
          chatId,
          telegramId,
        ]);
      } else {
        // No account yet - stage the phone number AND chat ID keyed by
        // telegram_id so auth.js can pick both up when they open the Mini
        // App for the first time and their account gets created.
        await query(
          `INSERT INTO pending_telegram_phones (telegram_id, phone, chat_id) VALUES ($1, $2, $3)
           ON CONFLICT (telegram_id) DO UPDATE SET phone = $2, chat_id = $3`,
          [telegramId, normalizedPhone, chatId]
        );
      }

      bot.sendMessage(chatId, 'Thanks! Your phone number has been saved.', {
        reply_markup: { remove_keyboard: true },
      });

      // Carry the referral code (if any) through to the Mini App as a
      // plain query parameter - see the comment at the top of this file
      // for why this is necessary instead of relying on start_param.
      const referralCode = pendingReferralCodes.get(chatId);
      pendingReferralCodes.delete(chatId);

      let launchUrl = miniAppUrl;
      if (launchUrl && referralCode) {
        const separator = launchUrl.includes('?') ? '&' : '?';
        launchUrl = `${launchUrl}${separator}ref=${encodeURIComponent(referralCode)}`;
      }

      // TEMPORARY DEBUG LOG - remove once referral tracking is confirmed
      // working. Shows exactly what this chat's captured referral code
      // was (if any) and the final Mini App URL sent, without touching
      // the database or requiring a live test account.
      logger.info('[bot] Sending Mini App button', { chatId, referralCode, launchUrl });

      bot.sendMessage(chatId, 'Tap below to start playing:', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Play Buna Games',
                web_app: { url: launchUrl },
              },
            ],
          ],
        },
      });
    } catch (err) {
      logger.error('[bot] Failed to save phone number', { error: err.message, telegramId });
      bot.sendMessage(chatId, 'Something went wrong saving your number. Please try /start again.');
    }
  });

  bot.on('polling_error', (err) => {
    logger.error('[bot] Polling error', { error: err.message });
  });

  logger.info('[bot] Telegram bot started (long polling)');

  // Store the running instance so getBotInstance() can hand it out to
  // other route files (e.g. admin.js's broadcast route) without creating
  // a second connection.
  botInstance = bot;

  return bot;
}

// Returns the currently-running bot instance, or null if the bot hasn't
// been started yet (e.g. TELEGRAM_BOT_TOKEN was missing at boot).
function getBotInstance() {
  return botInstance;
}

module.exports = { startBot, getBotInstance };
