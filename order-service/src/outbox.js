// OUTBOX PATTERN (explained simply)
//
// Problem: saving an order in PostgreSQL and sending a message to Kafka are
// two separate steps. If the service crashes between them, the order exists
// but nobody is told to charge it, or the reverse.
//
// Solution: do not talk to Kafka while saving. Instead, write the event into
// an "outbox" table in the SAME transaction as the order. A small worker
// then sends the unsent rows to Kafka. So an order can never exist without
// its event, and Kafka being down only delays the message.

const { log } = require('./util');

// Called inside a transaction (client = the transaction's connection)
async function addEvent(client, topic, key, eventType, payload) {
  await client.query('INSERT INTO outbox (topic, msg_key, event_type, payload) VALUES ($1, $2, $3, $4)', [
    topic,
    String(key),
    eventType,
    JSON.stringify(payload),
  ]);
}

// Sends rows that were not sent yet, oldest first.
// Marks a row as sent only AFTER Kafka accepted it. If we crash in between,
// the row is sent again later (duplicate), which is fine because every
// consumer is built to handle duplicates.
async function publishPending({ pool, publish, batchSize = 50 }) {
  const { rows } = await pool.query(
    'SELECT id, topic, msg_key, event_type, payload FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1',
    [batchSize]
  );
  let sent = 0;
  for (const row of rows) {
    await publish(row.topic, row.msg_key, row.event_type, row.payload);
    await pool.query('UPDATE outbox SET published_at = NOW() WHERE id = $1', [row.id]);
    sent++;
  }
  return sent;
}

function startOutboxWorker({ pool, publish, intervalMs = 1000 }) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // do not start a second run while one is still going
    running = true;
    try {
      await publishPending({ pool, publish });
    } catch (err) {
      log(`could not send outbox events yet (${err.message}). Will retry.`);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { addEvent, publishPending, startOutboxWorker };
