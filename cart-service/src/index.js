// Cart service. The gateway checks the login and sends the user id
// in the "x-user-id" header.

const express = require('express');
const Redis = require('ioredis');
const { createCartStore } = require('./cart');
const { log } = require('./util');

const PORT = process.env.PORT || 3003;
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
redis.on('error', (err) => log('redis error:', err.message));
const store = createCartStore(redis);

const app = express();
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'cart-service' }));

// Every cart route needs a logged-in user
app.use('/cart', (req, res, next) => {
  if (!req.headers['x-user-id']) return res.status(401).json({ message: 'Please log in first.' });
  req.userId = String(req.headers['x-user-id']);
  next();
});

// Wrap handlers so errors become clean JSON responses
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    log('cart error:', err.message);
    res.status(500).json({ message: 'Something went wrong with your cart.' });
  }
};

app.get('/cart', handle((req) => store.get(req.userId)));

app.post('/cart/items', (req, res) => {
  const { productId, name, price, emoji } = req.body || {};
  const qty = Number(req.body && req.body.qty) || 1;
  if (typeof productId !== 'string' || !productId || typeof name !== 'string' || !Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ message: 'productId, name and price are required.' });
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return res.status(400).json({ message: 'Quantity must be between 1 and 20.' });
  }
  return handle((r) => store.add(r.userId, { productId, name, price: Number(price), emoji, qty }))(req, res);
});

app.patch('/cart/items/:productId', (req, res) => {
  const qty = Number(req.body && req.body.qty);
  if (!Number.isInteger(qty) || qty < 0 || qty > 20) {
    return res.status(400).json({ message: 'Quantity must be between 0 and 20 (0 removes the item).' });
  }
  return handle((r) => store.setQty(r.userId, r.params.productId, qty))(req, res);
});

app.delete('/cart/items/:productId', handle((req) => store.remove(req.userId, req.params.productId)));
app.delete('/cart', handle((req) => store.clear(req.userId)));

app.listen(PORT, () => log(`cart-service listening on port ${PORT}`));
