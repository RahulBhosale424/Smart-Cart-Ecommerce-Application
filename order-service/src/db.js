// PostgreSQL connection + tables. Settings come from PGHOST, PGUSER,
// PGPASSWORD, PGDATABASE (set in docker-compose.yml).
//
// Orders need PostgreSQL because they must be saved safely:
// the order and all its items are written in ONE transaction.

const { Pool } = require('pg');
const { retry, log } = require('./util');

const pool = new Pool({ max: 10 });
pool.on('error', (err) => log('postgres pool error:', err.message));

// The auth service owns the default database. The order service uses its own
// database, so create it on first start if it does not exist yet.
async function ensureDatabase() {
  const name = process.env.PGDATABASE || 'smartcart_orders';
  const admin = new Pool({ database: 'postgres', max: 1 });
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
      log(`created database ${name}`);
    }
  } finally {
    await admin.end();
  }
}

async function init() {
  await retry(ensureDatabase, { label: 'postgres' });
  await retry(() => pool.query('SELECT 1'), { label: 'postgres' });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id             UUID PRIMARY KEY,
      user_id        TEXT NOT NULL,
      user_email     TEXT,
      status         TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING, CONFIRMED, CANCELLED
      total          NUMERIC(10,2) NOT NULL,
      shipping       JSONB,
      payment_id     TEXT,
      failure_reason TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- A copy of what was bought (name and price at purchase time)
    CREATE TABLE IF NOT EXISTS order_items (
      id         SERIAL PRIMARY KEY,
      order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      price      NUMERIC(10,2) NOT NULL,
      qty        INTEGER NOT NULL CHECK (qty > 0)
    );

    -- The "outbox": events waiting to be sent to Kafka
    CREATE TABLE IF NOT EXISTS outbox (
      id           BIGSERIAL PRIMARY KEY,
      topic        TEXT NOT NULL,
      msg_key      TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      payload      JSONB NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox(id) WHERE published_at IS NULL;
  `);
  log('database tables ready');
}

module.exports = { pool, init };
