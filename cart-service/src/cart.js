// A cart is stored in ONE Redis Hash per user:
//
//   key:    cart:<userId>
//   field:  <productId>
//   value:  JSON text with name, price, qty
//
// Why a Hash? Adding or removing one product only touches ONE field.
// We never have to read and rewrite the whole cart.

const CART_TTL_SECONDS = 7 * 24 * 3600; // an untouched cart disappears after 7 days
const MAX_DIFFERENT_ITEMS = 50;
const MAX_QTY_PER_ITEM = 20;

const cartKey = (userId) => `cart:${userId}`;

// Pure function (easy to test): list of items -> totals
function summarize(items) {
  const itemCount = items.reduce((sum, i) => sum + i.qty, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { items, itemCount, total: Math.round(total * 100) / 100 };
}

function createCartStore(redis) {
  async function get(userId) {
    const hash = await redis.hgetall(cartKey(userId));
    const items = Object.values(hash).map((json) => JSON.parse(json));
    return summarize(items);
  }

  async function add(userId, { productId, name, price, emoji, qty }) {
    const key = cartKey(userId);
    const existing = await redis.hget(key, productId);

    if (!existing && (await redis.hlen(key)) >= MAX_DIFFERENT_ITEMS) {
      throw Object.assign(new Error(`Your cart can hold up to ${MAX_DIFFERENT_ITEMS} different products.`), { status: 400 });
    }

    // Adding a product that is already in the cart increases its quantity
    const newQty = Math.min(MAX_QTY_PER_ITEM, (existing ? JSON.parse(existing).qty : 0) + qty);
    const item = { productId, name, price, emoji: emoji || '📦', qty: newQty };

    await redis.hset(key, productId, JSON.stringify(item));
    await redis.expire(key, CART_TTL_SECONDS);
    return get(userId);
  }

  async function setQty(userId, productId, qty) {
    const key = cartKey(userId);
    const existing = await redis.hget(key, productId);
    if (!existing) throw Object.assign(new Error('That item is not in your cart.'), { status: 404 });

    if (qty === 0) {
      await redis.hdel(key, productId);
    } else {
      const item = { ...JSON.parse(existing), qty: Math.min(MAX_QTY_PER_ITEM, qty) };
      await redis.hset(key, productId, JSON.stringify(item));
    }
    await redis.expire(key, CART_TTL_SECONDS);
    return get(userId);
  }

  async function remove(userId, productId) {
    await redis.hdel(cartKey(userId), productId);
    return get(userId);
  }

  async function clear(userId) {
    await redis.del(cartKey(userId));
    return summarize([]);
  }

  return { get, add, setQty, remove, clear };
}

module.exports = { createCartStore, summarize, cartKey, MAX_QTY_PER_ITEM };
