const { Pool } = require('pg');

// Supabase Postgres connection. Use the "Connection Pooling" URI from your
// Supabase project settings (Session or Transaction mode) as DATABASE_URL -
// this works well from a long-running Railway service.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
  console.error('[database] Unexpected error on idle Postgres client', err);
});

async function connectDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }
  // Simple connectivity check on boot.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[database] Connected to Postgres (Supabase)');
  } finally {
    client.release();
  }
}

/**
 * Thin query helper. Use parameterized queries ($1, $2, ...) everywhere -
 * never string-interpolate user input into SQL.
 */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { connectDatabase, query, pool };
