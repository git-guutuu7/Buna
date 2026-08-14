require('dotenv').config();

const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');

const { connectDatabase } = require('./database');
const logger = require('./logger');
const { startBot } = require('./bot');

const { router: authRouter } = require('./auth');
const walletRouter = require('./wallet');
const { router: gameRouter, attachSocket } = require('./game');
const { router: bingoRouter, attachBingoSocket } = require('./bingo');
const { attachWalletSocket } = require('./wallet_socket');
const adminRouter = require('./admin');
const referralRouter = require('./referral');
const couponsRouter = require('./coupons');
const cashbackRouter = require('./cashback');

const app = express();

/* ------------------------------------------------------------------ */
/*  Trust proxy (needed for correct client IPs / rate limiting behind    */
/*  a reverse proxy such as Railway's own edge doing TLS termination)     */
/* ------------------------------------------------------------------ */
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

/* ------------------------------------------------------------------ */
/*  Core security & parsing middleware                                  */
/* ------------------------------------------------------------------ */
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */
app.use('/api/auth', authRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/game', gameRouter);
app.use('/api/bingo', bingoRouter);
app.use('/api/admin', adminRouter);
app.use('/api/referral', referralRouter);
app.use('/api/coupons', couponsRouter);
app.use('/api/cashback', cashbackRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({ error: isProd && status === 500 ? 'Internal server error' : err.message });
});

/* ------------------------------------------------------------------ */
/*  HTTPS-ready server bootstrap                                        */
/* ------------------------------------------------------------------ */
async function start() {
  await connectDatabase();

  const port = process.env.PORT || 5000;
  let server;

  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    const options = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    };
    server = https.createServer(options, app);
    logger.info(`Starting HTTPS server on port ${port}`);
  } else {
    server = http.createServer(app);
    logger.info(`Starting HTTP server on port ${port} (set SSL_KEY_PATH/SSL_CERT_PATH for direct HTTPS, or terminate TLS at a reverse proxy)`);
  }

  const io = new SocketIOServer(server, {
    cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' },
  });
  attachSocket(io);
  attachBingoSocket(io);
  attachWalletSocket(io);

  server.listen(port, () => {
    logger.info(`Server listening on port ${port} [${process.env.NODE_ENV || 'development'}]`);

    // Start the Telegram bot (long polling) once the HTTP server is up.
    // No-ops safely if TELEGRAM_BOT_TOKEN isn't set.
    startBot();
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
