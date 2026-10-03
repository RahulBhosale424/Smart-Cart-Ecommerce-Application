const test = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../src/rateLimit');

function fakeRedis() {
  const counts = {};
  return {
    async incr(key) { counts[key] = (counts[key] || 0) + 1; return counts[key]; },
    async expire() {},
  };
}
const fakeRes = () => ({
  statusCode: 200,
  headers: {},
  set(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

test('allows requests under the limit and blocks after it', async () => {
  const limiter = createRateLimiter({ redis: fakeRedis(), max: 2 });
  const results = [];
  for (let i = 0; i < 3; i++) {
    const res = fakeRes();
    let passed = false;
    await limiter({ ip: '1.1.1.1' }, res, () => { passed = true; });
    results.push({ passed, status: res.statusCode });
  }
  assert.equal(results[0].passed, true);
  assert.equal(results[1].passed, true);
  assert.equal(results[2].passed, false);
  assert.equal(results[2].status, 429);
});

test('fails open when Redis is down', async () => {
  const broken = { async incr() { throw new Error('redis down'); } };
  const limiter = createRateLimiter({ redis: broken, max: 1 });
  let passed = false;
  await limiter({ ip: '1.1.1.1' }, fakeRes(), () => { passed = true; });
  assert.equal(passed, true);
});
