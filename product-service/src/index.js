// Product service: catalogue (MongoDB), cache + trending (Redis),
// stock (atomic updates), recommendations, and a Kafka listener that
// gives stock back when an order is cancelled.

const express = require('express');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const Product = require('./models/product');
const embeddings = require('./embeddings');
const { createCache } = require('./cache');
const { createRouters } = require('./routes');
const { startStockConsumer } = require('./consumer');
const { ensureTopics } = require('./kafka');
const { log, retry, waitReady } = require('./util');

const PORT = process.env.PORT || 3002;

async function main() {
  await retry(() => mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:27017/smartcart_products', { serverSelectionTimeoutMS: 5000 }), {
    label: 'mongodb',
  });
  log('connected to MongoDB');

  const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', (err) => log('redis error:', err.message));
  await waitReady(redis);
  log('connected to Redis');

  const cache = createCache(redis);

  await ensureTopics();
  await startStockConsumer({ Product, redis, cache });
  log('listening for order.cancelled events');

  const { router, internal } = createRouters({ Product, cache, embeddings });
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'product-service' }));
  app.use('/products', router);
  app.use('/internal', internal); // not reachable from outside: the gateway never routes here
  app.listen(PORT, () => log(`product-service listening on port ${PORT}`));
}

main().catch((err) => {
  log('startup failed:', err.message);
  process.exit(1);
});
