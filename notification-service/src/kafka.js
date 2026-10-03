// Small wrapper around KafkaJS so the rest of the code stays simple.
//
//   publish(topic, key, eventType, payload)   -> send an event
//   runConsumer({ groupId, topics, handler }) -> react to events
//
// Every event looks like: { eventType, timestamp, payload }

process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';
const { Kafka, logLevel } = require('kafkajs');
const { log, retry } = require('./util');

const kafka = new Kafka({
  clientId: process.env.SERVICE_NAME || 'smartcart',
  brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 500, retries: 10 },
});

// The 5 topics used by the order flow
const TOPICS = {
  ORDER_PLACED: 'order.placed',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_CANCELLED: 'order.cancelled',
};

// Create the topics if they do not exist yet (safe to run many times).
async function ensureTopics() {
  const admin = kafka.admin();
  await retry(() => admin.connect(), { label: 'kafka' });
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: 3, replicationFactor: 1 })),
    });
  } finally {
    await admin.disconnect();
  }
}

let producer = null;
async function getProducer() {
  if (!producer) {
    const p = kafka.producer({ allowAutoTopicCreation: false });
    await p.connect();
    producer = p;
  }
  return producer;
}

// key = orderId, so all events of one order go to the same partition
// and are processed in the right order.
async function publish(topic, key, eventType, payload) {
  const p = await getProducer();
  await p.send({
    topic,
    messages: [{ key: String(key), value: JSON.stringify({ eventType, timestamp: new Date().toISOString(), payload }) }],
  });
  log(`published ${eventType} (key=${key})`);
}

// Kafka may deliver the same message twice (at-least-once), so every
// handler passed in here MUST be safe to run twice.
async function runConsumer({ groupId, topics, handler }) {
  const consumer = kafka.consumer({ groupId });
  await retry(() => consumer.connect(), { label: 'kafka consumer' });
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: true });
  }
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch {
        log(`skipping malformed message on ${topic}`);
        return;
      }
      log(`received ${event.eventType}`);
      await handler(topic, event.payload, event);
    },
  });
  return consumer;
}

module.exports = { TOPICS, ensureTopics, publish, runConsumer };
