const test = require('node:test');
const assert = require('node:assert');
const { createPaymentProcessor } = require('../src/payments');
const { mockCharge, cardError } = require('../src/stripeClient');

function fakeRedis() {
  const data = new Map();
  return {
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v) { data.set(k, v); return 'OK'; },
  };
}
const order = (id = 'o1', paymentMethod = 'pm_card_visa') => ({ orderId: id, amount: 100, currency: 'inr', paymentMethod });

test('LAYER 1: the same order is charged only once, even if processed twice', async () => {
  let charges = 0;
  const processor = createPaymentProcessor({ redis: fakeRedis(), charge: async () => { charges++; return { id: 'pi_1' }; } });
  const first = await processor.process(order());
  const second = await processor.process(order()); // Kafka delivered it again
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.fromCache, true);
  assert.equal(second.paymentId, 'pi_1');
  assert.equal(charges, 1);
});

test('a declined card gives a clean failure result and is remembered', async () => {
  let charges = 0;
  const processor = createPaymentProcessor({
    redis: fakeRedis(),
    charge: async () => { charges++; throw cardError('Your card was declined.', 'card_declined'); },
  });
  const result = await processor.process(order('o2'));
  const again = await processor.process(order('o2'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Your card was declined.');
  assert.equal(again.fromCache, true);
  assert.equal(charges, 1);
});

test('declined cards never open the circuit breaker', async () => {
  const processor = createPaymentProcessor({
    redis: fakeRedis(),
    charge: async () => { throw cardError('Your card was declined.', 'card_declined'); },
  });
  for (let i = 0; i < 12; i++) await processor.process(order(`decl-${i}`));
  assert.equal(processor.state(), 'CLOSED');
});

test('when Stripe keeps failing the circuit OPENS and later payments fail instantly', async () => {
  let calls = 0;
  const processor = createPaymentProcessor({
    redis: fakeRedis(),
    charge: async () => { calls++; throw new Error('Stripe is down'); },
  });

  // 5 real failures (these are rethrown so Kafka would retry them)
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => processor.process(order(`out-${i}`)));
  }
  assert.equal(processor.state(), 'OPEN');

  const callsBefore = calls;
  const started = Date.now();
  const result = await processor.process(order('out-next'));
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.equal(calls, callsBefore); // Stripe was NOT called
  assert.ok(elapsed < 100, `should fail fast, took ${elapsed} ms`);
});

test('mock Stripe: success, decline and outage test cards', async () => {
  const ok = await mockCharge({ orderId: 'abcdef123', paymentMethod: 'pm_card_visa' });
  assert.equal(ok.status, 'succeeded');
  await assert.rejects(() => mockCharge({ orderId: 'x', paymentMethod: 'pm_card_chargeDeclined' }), (e) => e.type === 'StripeCardError');
  await assert.rejects(() => mockCharge({ orderId: 'x', paymentMethod: 'pm_simulate_outage' }), /outage/);
});
