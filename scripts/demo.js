// Runs the whole SmartCart story from the command line (needs Node 18+).
//
//   node scripts/demo.js           order success + declined card (stock restored) + out of stock
//   node scripts/demo.js outage    shows the circuit breaker opening (mock payments only)
//
// Requires: the stack is running and the products are seeded (see docs/SETUP.md).

const BASE = process.env.BASE_URL || 'http://localhost:8080'; // the API gateway
const PAYMENT_HEALTH = process.env.PAYMENT_HEALTH_URL || 'http://localhost:3005/health';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text = '') => console.log(text);
const step = (text) => console.log(`\n=== ${text}`);

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function register() {
  const email = `demo${Date.now()}@example.com`;
  const { status, data } = await call('/auth/register', { method: 'POST', body: { name: 'Demo User', email, password: 'Demo12345' } });
  if (status !== 201) throw new Error(`Could not register: ${data && data.message}. Is the stack running?`);
  say(`registered ${email}`);
  return data.token;
}

async function findProduct(namePart) {
  const { data } = await call('/products?limit=50');
  const product = data.products.find((p) => p.name.includes(namePart));
  if (!product) throw new Error(`Product "${namePart}" not found. Did you run the seed command?`);
  return product;
}

async function getStock(id) {
  const { data } = await call(`/products/${id}`);
  return data.stock;
}

async function addToCart(token, product, qty) {
  const { status, data } = await call('/cart/items', {
    method: 'POST', token, body: { productId: product.id, name: product.name, price: product.price, emoji: product.emoji, qty },
  });
  if (status !== 200) throw new Error(`Could not add to cart: ${data && data.message}`);
}

const shipping = { name: 'Demo User', address: '12 MG Road, Shivajinagar', city: 'Pune', pincode: '411005' };

async function placeOrder(token, paymentMethod) {
  return call('/orders', { method: 'POST', token, body: { shipping, paymentMethod } });
}

async function waitForFinalStatus(token, orderId, maxSeconds = 45) {
  const started = Date.now();
  while (Date.now() - started < maxSeconds * 1000) {
    const { data } = await call(`/orders/${orderId}`, { token });
    if (data && data.status !== 'PENDING') return { order: data, seconds: Math.round((Date.now() - started) / 100) / 10 };
    await sleep(1000);
  }
  return { order: null, seconds: maxSeconds };
}

async function waitForStock(id, expected, maxSeconds = 20) {
  const started = Date.now();
  while (Date.now() - started < maxSeconds * 1000) {
    if ((await getStock(id)) === expected) return true;
    await sleep(1000);
  }
  return false;
}

async function mainStory() {
  const token = await register();
  const shoes = await findProduct('Running Shoes Pro X');
  const watch = await findProduct('Smart Fitness Watch');

  step('1) Successful order');
  const before1 = await getStock(shoes.id);
  say(`stock of "${shoes.name}" before: ${before1}`);
  await addToCart(token, shoes, 1);
  const ok = await placeOrder(token, 'pm_card_visa');
  say(`POST /orders -> ${ok.status}, order ${ok.data.orderId} is ${ok.data.status}`);
  const done1 = await waitForFinalStatus(token, ok.data.orderId);
  say(`after ${done1.seconds}s the order is: ${done1.order && done1.order.status} (payment ${done1.order && done1.order.paymentId})`);
  say(`stock now: ${await getStock(shoes.id)} (went down by 1, correct)`);

  step('2) Declined card: order is cancelled and stock is restored');
  const before2 = await getStock(shoes.id);
  say(`stock before: ${before2}`);
  await addToCart(token, shoes, 2);
  const bad = await placeOrder(token, 'pm_card_chargeDeclined');
  say(`POST /orders -> ${bad.status}, order ${bad.data.orderId} is ${bad.data.status}`);
  say(`stock right after placing the order: ${await getStock(shoes.id)} (2 are reserved)`);
  const done2 = await waitForFinalStatus(token, bad.data.orderId);
  say(`after ${done2.seconds}s the order is: ${done2.order && done2.order.status} (${done2.order && done2.order.failureReason})`);
  const restored = await waitForStock(shoes.id, before2);
  say(`stock restored to ${await getStock(shoes.id)}: ${restored ? 'YES, matches the original ' + before2 : 'NOT YET (check the logs)'}`);

  step('3) Not enough stock');
  say(`"${watch.name}" has ${await getStock(watch.id)} in stock. Trying to buy 5...`);
  await addToCart(token, watch, 5);
  const tooMany = await placeOrder(token, 'pm_card_visa');
  say(`POST /orders -> ${tooMany.status}: ${tooMany.data.message}`);

  step('Done');
  say('Now open http://localhost:3100/orders (log in with the demo account) or read: docker compose logs -f order-service payment-service');
}

async function outageStory() {
  const token = await register();
  const bottle = await findProduct('Water Bottle');

  const health = async () => {
    try { return (await (await fetch(PAYMENT_HEALTH)).json()); } catch { return null; }
  };
  const h0 = await health();
  if (!h0) say('(could not read the payment-service health endpoint, is the stack running?)');
  else if (h0.mode !== 'mock') { say('This demo needs MOCK payments. Leave STRIPE_SECRET_KEY empty in .env and restart.'); return; }

  step('Stripe goes down: simulated');
  say(`circuit breaker state before: ${h0 && h0.circuitBreaker}`);
  for (let i = 1; i <= 2; i++) {
    await addToCart(token, bottle, 1);
    const placed = await placeOrder(token, 'pm_simulate_outage');
    say(`order ${i} placed: ${placed.data.orderId}`);
    const done = await waitForFinalStatus(token, placed.data.orderId, 60);
    const state = await health();
    say(`  -> ${done.order ? done.order.status : 'still pending'} after ${done.seconds}s, circuit breaker: ${state && state.circuitBreaker}`);
  }
  say('\nLook at the payment log to see the difference between a slow failure and a fast failure:');
  say('  docker compose logs payment-service | findstr /i "circuit error rejected"     (Windows)');
  say('  docker compose logs payment-service | grep -iE "circuit|error|rejected"       (Mac/Linux)');
  say('The first order is retried until the breaker opens; the second one is rejected almost instantly.');
}

(process.argv[2] === 'outage' ? outageStory() : mainStory()).catch((err) => {
  console.error('\nDemo failed:', err.message);
  process.exit(1);
});
