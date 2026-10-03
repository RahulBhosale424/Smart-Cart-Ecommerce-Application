// Very simple rate limiter: max N requests per minute per IP.
// Uses a Redis counter that expires after the window.

function createRateLimiter({ redis, windowSeconds = 60, max = 200 }) {
  return async function rateLimit(req, res, next) {
    try {
      const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
      const key = `gw:rate:${req.ip}:${bucket}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      res.set('X-RateLimit-Remaining', String(Math.max(0, max - count)));
      if (count > max) {
        return res.status(429).json({ message: 'Too many requests. Please slow down.' });
      }
    } catch {
      // If Redis is down we let the request through ("fail open").
      // Blocking every user because of a cache problem would be worse.
    }
    next();
  };
}

module.exports = { createRateLimiter };
