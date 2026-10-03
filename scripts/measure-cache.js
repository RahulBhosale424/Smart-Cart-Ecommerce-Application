// Measures how many product requests were answered from the Redis cache.
// Use the number you get here on your resume, not an invented one.
//
//   node scripts/measure-cache.js            (150 requests by default)
//   node scripts/measure-cache.js 300
//
// Requires: the stack is running and the products are seeded.

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TOTAL = Number(process.argv[2]) || 150;

async function get(path) {
  const res = await fetch(`${BASE}/api${path}`);
  return { status: res.status, cache: res.headers.get('x-cache'), data: await res.json().catch(() => null) };
}

async function main() {
  const list = await get('/products?limit=50');
  if (list.status !== 200 || !list.data.products.length) throw new Error('No products found. Run the seed command first.');
  const ids = list.data.products.map((p) => p.id);

  const before = (await get('/products/stats/cache')).data;
  const counts = { HIT: 0, MISS: 0, other: 0, rateLimited: 0 };

  console.log(`Sending ${TOTAL} requests (product pages and the product list, like a browsing user)...`);
  for (let i = 0; i < TOTAL; i++) {
    // 80% of the traffic looks at single products, 20% at the list
    const path = Math.random() < 0.8 ? `/products/${ids[Math.floor(Math.random() * ids.length)]}` : '/products?limit=12';
    const r = await get(path);
    if (r.status === 429) { counts.rateLimited++; continue; }
    counts[r.cache === 'HIT' || r.cache === 'MISS' ? r.cache : 'other']++;
  }

  const after = (await get('/products/stats/cache')).data;
  const hits = after.hits - before.hits;
  const misses = after.misses - before.misses;
  const total = hits + misses;

  console.log('\nResults for this test');
  console.log(`  answered from Redis (HIT):      ${hits}`);
  console.log(`  had to ask MongoDB (MISS):      ${misses}`);
  console.log(`  cache hit ratio:                ${total ? Math.round((hits / total) * 1000) / 10 : 0}%`);
  console.log(`  MongoDB reads avoided:          about ${total ? Math.round((hits / total) * 100) : 0}% (every HIT is one database read that did not happen)`);
  if (counts.rateLimited) console.log(`  (${counts.rateLimited} requests were rate limited, raise RATE_LIMIT_PER_MIN in .env)`);
  console.log('\nNote: this is a read-heavy browsing test. With other traffic the number will differ.');
  console.log('Run it again right away: the ratio goes up because the cache is already warm.');
  console.log(`Lifetime numbers since the cache started: ${JSON.stringify(after)}`);
}

main().catch((err) => {
  console.error('Measurement failed:', err.message);
  process.exit(1);
});
