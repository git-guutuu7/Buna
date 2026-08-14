const TelegramBot = require('node-telegram-bot-api');
const { query } = require('./database');
const logger = require('./logger');

let botInstance = null;
const pendingReferralCodes = new Map();

function startBot(app) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const miniAppUrl = process.env.MINI_APP_URL;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.BACKEND_URL;

  if (!token) {
    logger.warn('[bot] TELEGRAM_BOT_TOKEN not set - Telegram bot will not start');
    return null;
  }
  if (!miniAppUrl) {
    logger.warn('[bot] MINI_APP_URL not set - the Mini App button will not work');
  }

  // Initialize bot without polling
  const bot = new TelegramBot(token);

  if (domain && app) {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const webhookUrl = `https://${cleanDomain}/bot${token}`;

    bot
      .setWebHook(webhookUrl, { drop_pending_updates: true })
      .then(() => {
        logger.info(`[bot] Webhook successfully registered at: ${webhookUrl}`);
      })
      .catch((err) => {
        logger.error('[bot] Failed to set webhook:', { error: err.message });
      });

    // Handle incoming updates from Telegram
    app.post(`/bot${token}`, (req, res) => {
      try {
        bot.processUpdate(req.body);
      } catch (err) {
        logger.error('[bot] Error processing update:', { error: err.message });
      }
      res.sendStatus(200);
    });
  } else {
    logger.warn(
      '[bot] RAILWAY_PUBLIC_DOMAIN or Express app instance missing - Webhook could not be configured'
    );
  }

  // General message listener for /start
  bot.on('message', (msg) => {
    if (!msg.text) return;

    if (msg.text.startsWith('/start')) {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name || 'there';
      
      // Extract referral code if present (/start REF123)
      const parts = msg.text.split(' ');
      const referralCode = parts.length > 1 ? parts[1].trim() : null;

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
      ).catch((err) => {
        logger.error('[bot] Failed to send start message:', { error: err.message });
      });
    }
  });

  // Handle contact sharing
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

  botInstance = bot;
  return bot;
}

function getBotInstance() {
  return botInstance;
}

module.exports = { startBot, getBotInstance };
