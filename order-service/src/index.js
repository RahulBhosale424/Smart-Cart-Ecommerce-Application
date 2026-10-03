// Order service.
//
// POST /orders does these steps:
//   1. read the cart (cart-service)
//   2. reserve the stock (product-service, one atomic step)
//   3. save the order + the "order.placed" event in ONE database transaction
//   4. clear the cart
// The payment happens afterwards, through Kafka (payment-service).

const express = require('express');
const { pool, init } = require('./db');
const { createOrderStore } = require('./orders');
const { startOutboxWorker } = require('./outbox');
const { startPaymentResultConsumer } = require('./consumer');
const { validateOrderInput } = require('./logic');
const { ensureTopics, publish } = require('./kafka');
const { log } = require('./util');

const PORT = process.env.PORT || 3004;
const CART_URL = process.env.CART_SERVICE_URL || 'http://cart-service:3003';
const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const store = createOrderStore(pool);
const app = express();
app.use(express.json({ limit: '20kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

async function callService(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}

async function releaseStock(items) {
  try {
    await callService(`${PRODUCT_URL}/internal/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, qty: i.qty })) }),
    });
  } catch (err) {
    log(`WARNING could not release stock: ${err.message}`);
  }
}

app.post('/orders', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const email = req.headers['x-user-email'];
  if (!userId) return res.status(401).json({ message: 'Please log in first.' });

  const { errors, value } = validateOrderInput(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });

  // 1. read the cart
  let cart;
  try {
    const r = await callService(`${CART_URL}/cart`, { headers: { 'x-user-id': userId } });
    if (!r.ok) throw new Error(`cart-service answered ${r.status}`);
    cart = await r.json();
  } catch (err) {
    log('could not read the cart:', err.message);
    return res.status(503).json({ message: 'Could not read your cart. Please try again.' });
  }
  if (!cart.items || cart.items.length === 0) return res.status(400).json({ message: 'Your cart is empty.' });

  // 2. reserve the stock. Prices come back from the product database,
  //    so a customer can never change a price by editing the cart.
  let items;
  try {
    const r = await callService(`${PRODUCT_URL}/internal/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty })) }),
    });
    const body = await r.json();
    if (r.status === 409) return res.status(409).json({ message: body.message });
    if (!r.ok) throw new Error(`product-service answered ${r.status}`);
    items = body.items;
  } catch (err) {
    log('could not reserve stock:', err.message);
    return res.status(503).json({ message: 'Could not check stock. Please try again.' });
  }

  // 3. save order + event. If this fails, give the stock back.
  let order;
  try {
    order = await store.createOrder({ userId, email, items, shipping: value.shipping, paymentMethod: value.paymentMethod });
  } catch (err) {
    log('could not save the order:', err.message);
    await releaseStock(items);
    return res.status(500).json({ message: 'Could not place the order. Please try again.' });
  }

  // 4. clear the cart (not critical, so we do not wait for it)
  callService(`${CART_URL}/cart`, { method: 'DELETE', headers: { 'x-user-id': userId } }).catch((err) =>
    log('could not clear the cart:', err.message)
  );

  log(`order ${order.id} created for user ${userId}, total ${order.total}`);
  res.status(201).json({ orderId: order.id, status: 'PENDING', total: order.total });
});

app.get('/orders', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ message: 'Please log in first.' });
  try {
    res.json({ orders: await store.listOrders(userId) });
  } catch (err) {
    log('list orders error:', err.message);
    res.status(500).json({ message: 'Could not load your orders.' });
  }
});

app.get('/orders/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ message: 'Please log in first.' });
  if (!UUID.test(req.params.id)) return res.status(404).json({ message: 'Order not found.' });
  try {
    const order = await store.getOrder(req.params.id);
    // Customers can only see their own orders
    if (!order || (order.userId !== userId && req.headers['x-user-role'] !== 'admin')) {
      return res.status(404).json({ message: 'Order not found.' });
    }
    res.json(order);
  } catch (err) {
    log('get order error:', err.message);
    res.status(500).json({ message: 'Could not load the order.' });
  }
});

async function main() {
  await init();
  await ensureTopics();
  startOutboxWorker({ pool, publish });
  await startPaymentResultConsumer(store);
  app.listen(PORT, () => log(`order-service listening on port ${PORT}`));
}

main().catch((err) => {
  log('startup failed:', err.message);
  process.exit(1);
});
