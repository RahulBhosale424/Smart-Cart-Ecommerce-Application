// Notification service: listens to order events and emails the customer.
// If this service is down, orders still work. The events wait in Kafka
// and the emails go out when it comes back.

const http = require('http');
const { runConsumer, ensureTopics, TOPICS } = require('./kafka');
const { buildEmail, createSender } = require('./email');
const { log } = require('./util');

const PORT = process.env.PORT || 3006;

async function main() {
  const sender = createSender();
  log(`email mode: ${sender.mode}`);

  await ensureTopics();
  await runConsumer({
    groupId: 'notification-service-group',
    topics: [TOPICS.ORDER_CONFIRMED, TOPICS.ORDER_CANCELLED],
    handler: async (topic, payload, event) => {
      const email = buildEmail(event.eventType, payload);
      if (!email || !payload.email) return; // nothing to send, or no address known
      await sender.send({ to: payload.email, ...email });
    },
  });

  // tiny health endpoint so Docker can check the container
  http
    .createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', service: 'notification-service' }));
    })
    .listen(PORT, () => log(`notification-service health endpoint on port ${PORT}`));
}

main().catch((err) => {
  log('startup failed:', err.message);
  process.exit(1);
});
