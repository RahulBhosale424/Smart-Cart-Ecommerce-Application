// PostgreSQL connection + table creation.
// The Pool reads its settings from the standard PG* environment variables
// (PGHOST, PGUSER, PGPASSWORD, PGDATABASE), set in docker-compose.yml.

const { Pool } = require('pg');
const { retry, log } = require('./util');

const pool = new Pool({ max: 10 });
pool.on('error', (err) => log('postgres pool error:', err.message));

async function init() {
  await retry(() => pool.query('SELECT 1'), { label: 'postgres' });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  log('users table ready');
}

module.exports = { pool, init };
