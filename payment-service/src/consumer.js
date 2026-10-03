// Listens for "order.placed", takes the payment, and reports the result.

const { runConsumer, publish, TOPICS } = require('./kafka');

async function startPaymentConsumer(processor) {
  return runConsumer({
    groupId: 'payment-service-group',
    topics: [TOPICS.ORDER_PLACED],
    handler: async (topic, payload) => {
      const { orderId, total, currency, paymentMethod } = payload;
      const result = await processor.process({ orderId, amount: total, currency, paymentMethod });

      if (result.ok) {
        await publish(TOPICS.PAYMENT_COMPLETED, orderId, 'PAYMENT_COMPLETED', {
          orderId,
          paymentId: result.paymentId,
          amount: result.amount,
        });
      } else {
        await publish(TOPICS.PAYMENT_FAILED, orderId, 'PAYMENT_FAILED', { orderId, reason: result.reason });
      }
    },
  });
}

module.exports = { startPaymentConsumer };
