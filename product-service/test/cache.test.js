const test = require('node:test');
const assert = require('node:assert');
const { createCache } = require('../src/cache');

function fakeRedis() {
  const data = new Map();
  const ttls = {};
  return {
    data,
    ttls,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v, _ex, ttl) { data.set(k, v); ttls[k] = ttl; return 'OK'; },
    async incr(k) { const n = Number(data.get(k) || 0) + 1; data.set(k, String(n)); return n; },
    async del(...keys) { keys.forEach((k) => data.delete(k)); return keys.length; },
    scanStream({ match }) {
      const prefix = match.replace('*', '');
      const found = [...data.keys()].filter((k) => k.startsWith(prefix));
      return (async function* () { yield found; })();
    },
  };
}

test('first call is a MISS (loads from database), second call is a HIT', async () => {
  const cache = createCache(fakeRedis());
  let dbCalls = 0;
  const loader = async () => { dbCalls++; return { name: 'Shoes' }; };

  const first = await cache.getOrSet('product:1', 600, loader);
  const second = await cache.getOrSet('product:1', 600, loader);

  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.deepEqual(second.value, { name: 'Shoes' });
  assert.equal(dbCalls, 1); // the database was only asked once
});

test('hit ratio is calculated from hits and misses', async () => {
  const cache = createCache(fakeRedis());
  const loader = async () => ({ ok: true });
  await cache.getOrSet('k', 60, loader); // miss
  for (let i = 0; i < 4; i++) await cache.getOrSet('k', 60, loader); // 4 hits
  const stats = await cache.getStats();
  assert.equal(stats.hits, 4);
  assert.equal(stats.misses, 1);
  assert.equal(stats.hitRatioPercent, 80);
});

test('does not cache "not found" results', async () => {
  const redis = fakeRedis();
  const cache = createCache(redis);
  await cache.getOrSet('product:x', 60, async () => null);
  assert.equal(redis.data.has('product:x'), false);
});

test('TTL gets a little random extra time (jitter), never less than asked', async () => {
  const redis = fakeRedis();
  const cache = createCache(redis);
  await cache.getOrSet('a', 100, async () => 1);
  assert.ok(redis.ttls.a >= 100 && redis.ttls.a <= 110);
});

test('works (slower) when Redis is down', async () => {
  const broken = { async get() { throw new Error('down'); }, async incr() { throw new Error('down'); }, async set() { throw new Error('down'); } };
  const cache = createCache(broken);
  const result = await cache.getOrSet('k', 60, async () => ({ fromDb: true }));
  assert.deepEqual(result.value, { fromDb: true });
});

test('invalidateProducts removes product keys and list keys', async () => {
  const redis = fakeRedis();
  redis.data.set('product:1', 'x');
  redis.data.set('recs:1', 'x');
  redis.data.set('products:list:1:12:', 'x');
  redis.data.set('product:2', 'keep');
  const cache = createCache(redis);
  await cache.invalidateProducts(['1']);
  assert.equal(redis.data.has('product:1'), false);
  assert.equal(redis.data.has('recs:1'), false);
  assert.equal(redis.data.has('products:list:1:12:'), false);
  assert.equal(redis.data.has('product:2'), true);
});

test('trending returns products sorted by views', async () => {
  const redis = {
    async zincrby() {},
    async zrevrange() { return ['p2', '9', 'p1', '3']; },
  };
  const cache = createCache(redis);
  assert.deepEqual(await cache.topTrending(5), [{ id: 'p2', views: 9 }, { id: 'p1', views: 3 }]);
});
