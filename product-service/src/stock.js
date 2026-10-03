// Stock handling. This is the heart of "stock is restored if payment fails".
//
//   reserveItems  : take stock when an order is created
//   releaseItems  : give stock back
//   restoreOnce   : give stock back when an order was cancelled (runs at most ONCE per order)

// Combine duplicate lines and make sure every line is valid
function mergeItems(items) {
  const merged = new Map();
  for (const item of items || []) {
    const qty = Number(item.qty);
    if (!item.productId || !Number.isInteger(qty) || qty < 1) throw new Error('Invalid item in list');
    const id = String(item.productId);
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

async function releaseItems(Product, items) {
  for (const item of mergeItems(items)) {
    await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.qty } });
  }
}

async function reserveItems(Product, items) {
  const wanted = mergeItems(items);
  const reserved = [];
  const details = [];

  for (const item of wanted) {
    // ONE atomic database step: "reduce stock only if there is enough".
    // Two customers can never both get the last item, because MongoDB
    // runs this check-and-reduce as a single operation.
    const updated = await Product.findOneAndUpdate(
      { _id: item.productId, isActive: true, stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty } },
      { new: true }
    );

    if (!updated) {
      // Not enough stock: put back everything we already took for this order
      await releaseItems(Product, reserved);
      const product = await Product.findById(item.productId);
      return { ok: false, productId: item.productId, name: product ? product.name : 'this item', available: product ? product.stock : 0 };
    }

    reserved.push(item);
    // The price comes from OUR database, never from the customer's cart
    details.push({ productId: item.productId, name: updated.name, price: updated.price, qty: item.qty });
  }
  return { ok: true, items: details };
}

// Called when Kafka delivers "order.cancelled". Kafka can deliver the same
// message twice, so a Redis key remembers which orders were already restored.
async function restoreOnce({ Product, redis, orderId, items }) {
  const key = `stock:restored:${orderId}`;
  const firstTime = await redis.set(key, '1', 'EX', 7 * 24 * 3600, 'NX'); // NX = only if not set yet
  if (firstTime !== 'OK') return false; // already restored earlier, do nothing

  try {
    await releaseItems(Product, items);
  } catch (err) {
    await redis.del(key); // let the retry try again
    throw err;
  }
  return true;
}

module.exports = { mergeItems, reserveItems, releaseItems, restoreOnce };
