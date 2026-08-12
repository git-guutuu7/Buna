// Minimal structured logger. Swap for pino/winston in production if desired.
function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (msg, meta = {}) => console.log(`[${timestamp()}] INFO: ${msg}`, meta),
  warn: (msg, meta = {}) => console.warn(`[${timestamp()}] WARN: ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`[${timestamp()}] ERROR: ${msg}`, meta),
};

module.exports = logger;
