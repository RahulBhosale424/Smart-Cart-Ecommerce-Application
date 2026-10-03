// Listens to the payment result and finishes the order. (This is the Saga.)
//   payment.completed -> order becomes CONFIRMED
//   payment.failed    -> order becomes CANCELLED (stock goes back, user is emailed)

const { runConsumer, TOPICS } = require('./kafka');
const { log } = require('./util');

async function startPaymentResultConsumer(store) {
  return runConsumer({
    groupId: 'order-service-group',
    topics: [TOPICS.PAYMENT_COMPLETED, TOPICS.PAYMENT_FAILED],
    handler: async (topic, payload) => {
      if (topic === TOPICS.PAYMENT_COMPLETED) {
        const changed = await store.confirmOrder(payload.orderId, payload.paymentId);
        log(changed ? `order ${payload.orderId} CONFIRMED` : `order ${payload.orderId} already handled, skipping`);
      } else if (topic === TOPICS.PAYMENT_FAILED) {
        const changed = await store.cancelOrder(payload.orderId, payload.reason);
        log(changed ? `order ${payload.orderId} CANCELLED (${payload.reason})` : `order ${payload.orderId} already handled, skipping`);
      }
    },
  });
}

module.exports = { startPaymentResultConsumer };
