// Payment service. No public API: it only reacts to Kafka events.
// It has a small /health endpoint that also shows the circuit breaker state.

const express = require('express');
const Redis = require('ioredis');
const { createCharge } = require('./stripeClient');
const { createPaymentProcessor } = require('./payments');
const { startPaymentConsumer } = require('./consumer');
const { ensureTopics } = require('./kafka');
const { log } = require('./util');

const PORT = process.env.PORT || 3005;

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
  redis.on('error', (err) => log('redis error:', err.message));

  const { mode, charge } = createCharge({ secretKey: process.env.STRIPE_SECRET_KEY });
  log(mode === 'stripe' ? 'using the real Stripe API (test mode keys)' : 'STRIPE_SECRET_KEY is empty: using MOCK payments');

  const processor = createPaymentProcessor({ redis, charge });

  await ensureTopics();
  await startPaymentConsumer(processor);

  const app = express();
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payment-service', mode, circuitBreaker: processor.state() }));
  app.listen(PORT, () => log(`payment-service listening on port ${PORT}`));
}

main().catch((err) => {
  log('startup failed:', err.message);
  process.exit(1);
});
