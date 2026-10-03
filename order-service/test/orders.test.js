// Tests the order status rules with a fake database that behaves like
// "UPDATE ... WHERE status = 'PENDING'".
const test = require('node:test');
const assert = require('node:assert');
const { createOrderStore } = require('../src/orders');

function fakePool() {
  const order = { id: 'o1', user_id: 'u1', user_email: 'a@b.co', status: 'PENDING', total: '300.00', failure_reason: null };
  const outbox = [];
  const client = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes("SET status = 'CONFIRMED'") || sql.includes("SET status = 'CANCELLED'")) {
        if (order.status !== 'PENDING') return { rows: [] };
        order.status = sql.includes('CONFIRMED') ? 'CONFIRMED' : 'CANCELLED';
        if (order.status === 'CANCELLED') order.failure_reason = params[1];
        return { rows: [{ ...order }] };
      }
      if (sql.startsWith('SELECT product_id')) return { rows: [{ product_id: 'p1', qty: 2 }] };
      if (sql.startsWith('INSERT INTO outbox')) { outbox.push(params[2]); return { rows: [] }; }
      throw new Error('unexpected sql: ' + sql);
    },
    release() {},
  };
  return { order, outbox, async connect() { return client; } };
}

test('confirming works once; a duplicate "payment completed" message does nothing', async () => {
  const pool = fakePool();
  const store = createOrderStore(pool);
  assert.equal(await store.confirmOrder('o1', 'pi_1'), true);
  assert.equal(await store.confirmOrder('o1', 'pi_1'), false); // duplicate
  assert.equal(pool.order.status, 'CONFIRMED');
  assert.deepEqual(pool.outbox, ['ORDER_CONFIRMED']); // only ONE event was created
});

test('cancelling creates an "order cancelled" event with the items to restore', async () => {
  const pool = fakePool();
  const store = createOrderStore(pool);
  assert.equal(await store.cancelOrder('o1', 'Your card was declined.'), true);
  assert.equal(pool.order.status, 'CANCELLED');
  assert.equal(pool.order.failure_reason, 'Your card was declined.');
  assert.deepEqual(pool.outbox, ['ORDER_CANCELLED']);
});

test('a confirmed order cannot be cancelled afterwards', async () => {
  const pool = fakePool();
  const store = createOrderStore(pool);
  await store.confirmOrder('o1', 'pi_1');
  assert.equal(await store.cancelOrder('o1', 'late failure message'), false);
  assert.equal(pool.order.status, 'CONFIRMED');
});
