const test = require('node:test');
const assert = require('node:assert');
const { createCartStore, summarize } = require('../src/cart');

// Fake Redis with just the hash commands the cart uses
function fakeRedis() {
  const hashes = {};
  return {
    async hgetall(k) { return { ...(hashes[k] || {}) }; },
    async hget(k, f) { return (hashes[k] || {})[f] || null; },
    async hset(k, f, v) { (hashes[k] = hashes[k] || {})[f] = v; },
    async hdel(k, f) { if (hashes[k]) delete hashes[k][f]; },
    async hlen(k) { return Object.keys(hashes[k] || {}).length; },
    async del(k) { delete hashes[k]; },
    async expire() {},
  };
}

test('summarize adds up items, quantities and the total', () => {
  const s = summarize([{ price: 99.99, qty: 3 }, { price: 10, qty: 1 }]);
  assert.equal(s.itemCount, 4);
  assert.equal(s.total, 309.97);
});

test('adding the same product twice increases the quantity', async () => {
  const store = createCartStore(fakeRedis());
  await store.add('u1', { productId: 'p1', name: 'Shoes', price: 100, qty: 1 });
  const cart = await store.add('u1', { productId: 'p1', name: 'Shoes', price: 100, qty: 2 });
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].qty, 3);
  assert.equal(cart.total, 300);
});

test('quantity is capped at 20 per product', async () => {
  const store = createCartStore(fakeRedis());
  await store.add('u1', { productId: 'p1', name: 'Pen', price: 5, qty: 15 });
  const cart = await store.add('u1', { productId: 'p1', name: 'Pen', price: 5, qty: 15 });
  assert.equal(cart.items[0].qty, 20);
});

test('setting quantity to 0 removes the item', async () => {
  const store = createCartStore(fakeRedis());
  await store.add('u1', { productId: 'p1', name: 'Shoes', price: 100, qty: 1 });
  const cart = await store.setQty('u1', 'p1', 0);
  assert.equal(cart.items.length, 0);
});

test('changing a product that is not in the cart gives a 404 error', async () => {
  const store = createCartStore(fakeRedis());
  await assert.rejects(() => store.setQty('u1', 'nope', 2), (err) => err.status === 404);
});

test('carts of different users are separate', async () => {
  const store = createCartStore(fakeRedis());
  await store.add('u1', { productId: 'p1', name: 'Shoes', price: 100, qty: 1 });
  assert.equal((await store.get('u2')).items.length, 0);
});

test('clear empties the cart', async () => {
  const store = createCartStore(fakeRedis());
  await store.add('u1', { productId: 'p1', name: 'Shoes', price: 100, qty: 1 });
  await store.clear('u1');
  assert.equal((await store.get('u1')).itemCount, 0);
});
