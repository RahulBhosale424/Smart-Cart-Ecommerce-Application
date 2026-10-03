// Redis helpers for the product service.
//
//  1. Cache-aside:   look in Redis first; on a miss load from MongoDB and save it.
//  2. Cache stats:   count hits and misses so we can PROVE how much load we save.
//  3. Trending:      a Redis Sorted Set (score = number of views).

const HITS = 'stats:cache:hits';
const MISSES = 'stats:cache:misses';
const TRENDING = 'trending:products';

// How long things stay in the cache (seconds)
const TTL = { product: 600, list: 120, recommendations: 600 };

function createCache(redis) {
  // Every Redis call is wrapped: if Redis has a problem the API still works,
  // it is just slower (it falls back to MongoDB).
  async function safe(fn) {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  // Add up to 10% random time so many keys do not all expire at the same moment
  const withJitter = (ttl) => Math.floor(ttl + Math.random() * ttl * 0.1);

  async function getOrSet(key, ttl, loader) {
    const cached = await safe(() => redis.get(key));
    if (cached) {
      safe(() => redis.incr(HITS));
      return { value: JSON.parse(cached), cache: 'HIT' };
    }
    safe(() => redis.incr(MISSES));
    const value = await loader(); // go to MongoDB
    if (value !== null && value !== undefined) {
      await safe(() => redis.set(key, JSON.stringify(value), 'EX', withJitter(ttl)));
    }
    return { value, cache: 'MISS' };
  }

  // Delete keys by pattern using SCAN.
  // SCAN reads a few keys at a time. KEYS would freeze Redis while it reads all of them.
  async function deleteByPattern(pattern) {
    let deleted = 0;
    const stream = redis.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream) {
      if (keys.length) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    }
    return deleted;
  }

  // Product data changed (price, stock...): remove old copies from the cache
  async function invalidateProducts(ids = []) {
    const keys = ids.flatMap((id) => [`product:${id}`, `recs:${id}`]);
    if (keys.length) await safe(() => redis.del(...keys));
    await safe(() => deleteByPattern('products:list:*'));
  }

  async function getStats() {
    const [h, m] = await Promise.all([redis.get(HITS), redis.get(MISSES)]);
    const hits = Number(h || 0);
    const misses = Number(m || 0);
    const total = hits + misses;
    return {
      hits,
      misses,
      total,
      hitRatioPercent: total ? Math.round((hits / total) * 1000) / 10 : 0,
    };
  }

  // Trending: every product view adds 1 to that product's score
  async function trackView(productId) {
    return safe(() => redis.zincrby(TRENDING, 1, String(productId)));
  }

  async function topTrending(limit = 8) {
    const flat = (await safe(() => redis.zrevrange(TRENDING, 0, limit - 1, 'WITHSCORES'))) || [];
    const result = [];
    for (let i = 0; i < flat.length; i += 2) result.push({ id: flat[i], views: Number(flat[i + 1]) });
    return result;
  }

  return { getOrSet, deleteByPattern, invalidateProducts, getStats, trackView, topTrending, TTL };
}

module.exports = { createCache, TTL, HITS, MISSES, TRENDING };
