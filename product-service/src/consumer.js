// Listens to Kafka. When an order is cancelled (payment failed),
// the stock that was reserved for it goes back on the shelf.

const { runConsumer, TOPICS } = require('./kafka');
const { restoreOnce } = require('./stock');
const { log } = require('./util');

async function startStockConsumer({ Product, redis, cache }) {
  return runConsumer({
    groupId: 'product-service-group',
    topics: [TOPICS.ORDER_CANCELLED],
    handler: async (topic, payload) => {
      const { orderId, items } = payload;
      const restored = await restoreOnce({ Product, redis, orderId, items });
      if (restored) {
        await cache.invalidateProducts(items.map((i) => i.productId));
        log(`stock restored for cancelled order ${orderId}`);
      } else {
        log(`stock for order ${orderId} was already restored, skipping`);
      }
    },
  });
}

module.exports = { startStockConsumer };
