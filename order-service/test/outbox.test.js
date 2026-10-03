const test = require('node:test');
const assert = require('node:assert');
const { publishPending, addEvent } = require('../src/outbox');

function fakePool(rows) {
  const marked = [];
  return {
    marked,
    async query(sql, params) {
      if (sql.startsWith('SELECT')) return { rows: rows.filter((r) => !marked.includes(r.id)) };
      if (sql.startsWith('UPDATE')) { marked.push(params[0]); return { rows: [] }; }
      throw new Error('unexpected sql');
    },
  };
}

test('sends unsent events in order and marks each one as sent', async () => {
  const pool = fakePool([
    { id: 1, topic: 'order.placed', msg_key: 'o1', event_type: 'ORDER_PLACED', payload: { a: 1 } },
    { id: 2, topic: 'order.confirmed', msg_key: 'o1', event_type: 'ORDER_CONFIRMED', payload: { b: 2 } },
  ]);
  const sent = [];
  const count = await publishPending({ pool, publish: async (...args) => sent.push(args) });
  assert.equal(count, 2);
  assert.deepEqual(sent.map((s) => s[2]), ['ORDER_PLACED', 'ORDER_CONFIRMED']);
  assert.deepEqual(pool.marked, [1, 2]);
});

test('if Kafka fails, the event is NOT marked as sent, so it is retried later', async () => {
  const pool = fakePool([{ id: 1, topic: 't', msg_key: 'k', event_type: 'E', payload: {} }]);
  await assert.rejects(() => publishPending({ pool, publish: async () => { throw new Error('kafka down'); } }));
  assert.deepEqual(pool.marked, []);
  // later, Kafka is back
  const count = await publishPending({ pool, publish: async () => {} });
  assert.equal(count, 1);
});

test('addEvent writes into the outbox table using the transaction connection', async () => {
  const calls = [];
  await addEvent({ query: async (sql, params) => calls.push({ sql, params }) }, 'order.placed', 'o1', 'ORDER_PLACED', { x: 1 });
  assert.ok(calls[0].sql.includes('INSERT INTO outbox'));
  assert.equal(calls[0].params[0], 'order.placed');
  assert.equal(calls[0].params[3], JSON.stringify({ x: 1 }));
});
