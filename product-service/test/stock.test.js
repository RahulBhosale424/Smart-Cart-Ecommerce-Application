const test = require('node:test');
const assert = require('node:assert');
const { reserveItems, releaseItems, restoreOnce, mergeItems } = require('../src/stock');

// A tiny fake of the Mongoose model, with the same "check and reduce" rule
function fakeProduct(initial) {
  const db = new Map(Object.entries(initial).map(([id, p]) => [id, { isActive: true, ...p }]));
  return {
    db,
    async findOneAndUpdate(filter, update) {
      const p = db.get(filter._id);
      if (!p || !p.isActive || p.stock < filter.stock.$gte) return null;
      p.stock += update.$inc.stock;
      return { ...p };
    },
    async findById(id) { const p = db.get(id); return p ? { ...p } : null; },
    async updateOne(filter, update) { db.get(filter._id).stock += update.$inc.stock; },
  };
}

function fakeRedis() {
  const keys = new Set();
  return {
    async set(k, _v, _ex, _ttl, nx) { if (nx === 'NX' && keys.has(k)) return null; keys.add(k); return 'OK'; },
    async del(k) { keys.delete(k); },
  };
}

test('reserving reduces stock and returns the real price from the database', async () => {
  const Product = fakeProduct({ a: { name: 'Shoes', price: 100, stock: 5 } });
  const r = await reserveItems(Product, [{ productId: 'a', qty: 2 }]);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].price, 100);
  assert.equal(Product.db.get('a').stock, 3);
});

test('if one item is out of stock, items already reserved are put back', async () => {
  const Product = fakeProduct({
    a: { name: 'Shoes', price: 100, stock: 5 },
    b: { name: 'Watch', price: 900, stock: 1 },
  });
  const r = await reserveItems(Product, [{ productId: 'a', qty: 2 }, { productId: 'b', qty: 3 }]);
  assert.equal(r.ok, false);
  assert.equal(r.name, 'Watch');
  assert.equal(Product.db.get('a').stock, 5); // rolled back
  assert.equal(Product.db.get('b').stock, 1);
});

test('cannot buy more than the stock (last item cannot be sold twice)', async () => {
  const Product = fakeProduct({ a: { name: 'Watch', price: 900, stock: 1 } });
  const first = await reserveItems(Product, [{ productId: 'a', qty: 1 }]);
  const second = await reserveItems(Product, [{ productId: 'a', qty: 1 }]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(Product.db.get('a').stock, 0);
});

test('stock is restored when an order is cancelled, but only once', async () => {
  const Product = fakeProduct({ a: { name: 'Shoes', price: 100, stock: 3 } });
  const redis = fakeRedis();
  const items = [{ productId: 'a', qty: 2 }];

  const first = await restoreOnce({ Product, redis, orderId: 'order-1', items });
  const duplicate = await restoreOnce({ Product, redis, orderId: 'order-1', items }); // Kafka delivers twice

  assert.equal(first, true);
  assert.equal(duplicate, false);
  assert.equal(Product.db.get('a').stock, 5); // 3 + 2, not 3 + 4
});

test('mergeItems combines duplicates and rejects bad quantities', () => {
  assert.deepEqual(mergeItems([{ productId: 'a', qty: 1 }, { productId: 'a', qty: 2 }]), [{ productId: 'a', qty: 3 }]);
  assert.throws(() => mergeItems([{ productId: 'a', qty: 0 }]));
  assert.throws(() => mergeItems([{ productId: 'a', qty: 1.5 }]));
});

test('releaseItems adds stock back', async () => {
  const Product = fakeProduct({ a: { name: 'Shoes', price: 100, stock: 1 } });
  await releaseItems(Product, [{ productId: 'a', qty: 4 }]);
  assert.equal(Product.db.get('a').stock, 5);
});
