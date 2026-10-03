// API Gateway: the ONLY service the browser talks to.
//   /api/auth/*      -> auth-service
//   /api/products/*  -> product-service
//   /api/cart/*      -> cart-service
//   /api/orders/*    -> order-service
// Payment and notification services are internal (event driven), not exposed.

const express = require('express');
const Redis = require('ioredis');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createAuthMiddleware } = require('./auth');
const { createRateLimiter } = require('./rateLimit');
const { log } = require('./util');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  log('JWT_SECRET is missing. Set it in the .env file.');
  process.exit(1);
}

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
redis.on('error', (err) => log('redis error:', err.message));

const app = express();
app.set('trust proxy', 1); // the frontend (Next.js) sits in front of us and forwards the client IP

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

app.use(createRateLimiter({ redis, max: Number(process.env.RATE_LIMIT_PER_MIN) || 200 }));
app.use(createAuthMiddleware({ secret: JWT_SECRET }));

// NOTE: we do not use express.json() here on purpose, the gateway just
// passes the raw request through to the service.
function proxyTo(prefix, target, rewriteTo) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter: prefix,
    pathRewrite: { [`^${prefix}`]: rewriteTo },
    proxyTimeout: 15000,
    on: {
      error: (err, req, res) => {
        log(`proxy error for ${prefix}: ${err.message}`);
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'That service is temporarily unavailable. Please try again.' }));
        }
      },
    },
  });
}

app.use(proxyTo('/api/auth', process.env.AUTH_SERVICE_URL || 'http://auth-service:3001', '/auth'));
app.use(proxyTo('/api/products', process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002', '/products'));
app.use(proxyTo('/api/cart', process.env.CART_SERVICE_URL || 'http://cart-service:3003', '/cart'));
app.use(proxyTo('/api/orders', process.env.ORDER_SERVICE_URL || 'http://order-service:3004', '/orders'));

app.use((req, res) => res.status(404).json({ message: `${req.method} ${req.path} not found` }));

if (require.main === module) {
  app.listen(PORT, () => log(`API gateway listening on port ${PORT}`));
}

module.exports = app;
