const TelegramBot = require('node-telegram-bot-api');
const { query } = require('./database');
const logger = require('./logger');

// Runs the Telegram bot using long polling. Started once from server.js.
let botInstance = null;

// Referral codes captured from /start, keyed by telegram chat id
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

  // Configured with custom polling params to prevent fatal network drops
  const bot = new TelegramBot(token, {
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10,
      },
    },
  });

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

    if (msg.contact.user_id !== telegramId) {
      bot.sendMessage(chatId, 'Please share your own phone number using the button provided.');
      return;
    }

    try {
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      const { rows } = await query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);

      if (rows.length > 0) {
        await query('UPDATE users SET telegram_phone = $1, telegram_chat_id = $2 WHERE telegram_id = $3', [
          normalizedPhone,
          chatId,
          telegramId,
        ]);
      } else {
        await query(
          `INSERT INTO pending_telegram_phones (telegram_id, phone, chat_id) VALUES ($1, $2, $3)
           ON CONFLICT (telegram_id) DO UPDATE SET phone = $2, chat_id = $3`,
          [telegramId, normalizedPhone, chatId]
        );
      }

      bot.sendMessage(chatId, 'Thanks! Your phone number has been saved.', {
        reply_markup: { remove_keyboard: true },
      });

      const referralCode = pendingReferralCodes.get(chatId);
      pendingReferralCodes.delete(chatId);

      let launchUrl = miniAppUrl;
      if (launchUrl && referralCode) {
        const separator = launchUrl.includes('?') ? '&' : '?';
        launchUrl = `${launchUrl}${separator}ref=${encodeURIComponent(referralCode)}`;
      }

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

  // Suppress transient network errors to prevent crash loop on Railway
  bot.on('polling_error', (err) => {
    logger.warn('[bot] Polling network warning:', err.code || err.message);
  });

  logger.info('[bot] Telegram bot started (long polling)');

  botInstance = bot;

  return bot;
}

function getBotInstance() {
  return botInstance;
}

module.exports = { startBot, getBotInstance };
