// Fills the database with sample products.
// Run:  docker compose exec product-service node src/seed.js
// Running it again is safe: it updates products by name (and resets their stock).

const mongoose = require('mongoose');
const Redis = require('ioredis');
const Product = require('./models/product');
const embeddings = require('./embeddings');
const { createCache } = require('./cache');
const { log, retry } = require('./util');

const products = [
  { name: 'Wireless Noise-Cancelling Headphones', category: 'electronics', brand: 'SoundPro', emoji: '🎧', price: 2999, stock: 40,
    description: 'Over-ear Bluetooth headphones with active noise cancellation and 30 hour battery life for music and calls.',
    tags: ['headphones', 'wireless', 'bluetooth', 'audio', 'noise cancelling'], specs: [{ key: 'Battery', value: '30 hours' }, { key: 'Connectivity', value: 'Bluetooth 5.0' }] },
  { name: 'Bluetooth Earbuds Pro', category: 'electronics', brand: 'SoundPro', emoji: '🎧', price: 1999, stock: 60,
    description: 'True wireless earbuds with clear sound, noise reduction and a charging case. Great for music and calls.',
    tags: ['earbuds', 'wireless', 'bluetooth', 'audio'], specs: [{ key: 'Battery', value: '8 hours + case' }] },
  { name: 'Mechanical Gaming Keyboard', category: 'electronics', brand: 'KeyMaster', emoji: '⌨️', price: 4499, stock: 25,
    description: 'Tactile mechanical keyboard with RGB backlight, anti-ghosting keys and a detachable USB-C cable.',
    tags: ['keyboard', 'gaming', 'mechanical', 'rgb', 'computer'], specs: [{ key: 'Switch', value: 'Brown' }] },
  { name: 'Smart Fitness Watch', category: 'electronics', brand: 'TechWear', emoji: '⌚', price: 8999, stock: 3,
    description: 'Smartwatch with heart rate tracking, GPS, sleep tracking and 7 day battery for running and fitness.',
    tags: ['watch', 'fitness', 'smartwatch', 'gps', 'health'], specs: [{ key: 'Display', value: '1.4 inch AMOLED' }] },
  { name: 'Running Shoes Pro X', category: 'footwear', brand: 'SpeedRun', emoji: '👟', price: 3499, stock: 80,
    description: 'Lightweight running shoes with cushioned sole and breathable mesh for daily running and jogging.',
    tags: ['shoes', 'running', 'sports', 'lightweight'], specs: [{ key: 'Weight', value: '280 g' }] },
  { name: 'Trail Running Shoes', category: 'footwear', brand: 'SpeedRun', emoji: '🥾', price: 3999, stock: 45,
    description: 'Grippy running shoes for trails and rough ground, with a strong sole and water resistant upper.',
    tags: ['shoes', 'running', 'trail', 'outdoor'], specs: [{ key: 'Grip', value: 'Deep lugs' }] },
  { name: 'Leather Casual Sneakers', category: 'footwear', brand: 'UrbanStep', emoji: '👞', price: 2799, stock: 55,
    description: 'Classic leather sneakers for everyday wear, comfortable to walk in and easy to match with jeans.',
    tags: ['shoes', 'sneakers', 'casual', 'leather'], specs: [{ key: 'Material', value: 'Leather' }] },
  { name: 'Laptop Backpack 30L', category: 'accessories', brand: 'TravelPro', emoji: '🎒', price: 1299, stock: 100,
    description: 'Water resistant backpack with padded laptop compartment, fits laptops up to 16 inch. For college and travel.',
    tags: ['backpack', 'laptop', 'travel', 'college', 'bag'], specs: [{ key: 'Capacity', value: '30 litres' }] },
  { name: 'Insulated Steel Water Bottle 1L', category: 'sports', brand: 'HydroLife', emoji: '🧴', price: 799, stock: 150,
    description: 'Double wall steel bottle that keeps drinks cold for 24 hours or hot for 12 hours. Leak proof lid.',
    tags: ['bottle', 'water', 'gym', 'steel'], specs: [{ key: 'Capacity', value: '1 litre' }] },
  { name: 'Non-Slip Yoga Mat', category: 'sports', brand: 'FlexFit', emoji: '🧘', price: 999, stock: 70,
    description: 'Thick non-slip yoga and exercise mat with a carry strap. Good for yoga, stretching and home workouts.',
    tags: ['yoga', 'mat', 'fitness', 'exercise', 'gym'], specs: [{ key: 'Thickness', value: '6 mm' }] },
  { name: 'Organic Cotton T-Shirt', category: 'clothing', brand: 'EcoWear', emoji: '👕', price: 599, stock: 200,
    description: 'Soft and breathable t-shirt made from 100 percent organic cotton with a relaxed everyday fit.',
    tags: ['tshirt', 'cotton', 'clothing', 'casual'], specs: [{ key: 'Material', value: 'Organic cotton' }] },
  { name: 'JavaScript: The Good Parts', category: 'books', brand: "O'Reilly", emoji: '📘', price: 499, stock: 90,
    description: 'A classic programming book about the best features of JavaScript, for students and developers.',
    tags: ['book', 'javascript', 'programming', 'coding'], specs: [{ key: 'Pages', value: '176' }] },
  { name: 'Ceramic Coffee Mug Set', category: 'home', brand: 'HomeNest', emoji: '☕', price: 699, stock: 65,
    description: 'Set of four ceramic coffee mugs, microwave and dishwasher safe. For coffee, tea and hot drinks.',
    tags: ['mug', 'coffee', 'kitchen', 'ceramic'], specs: [{ key: 'Pieces', value: '4' }] },
  { name: 'LED Desk Lamp', category: 'home', brand: 'HomeNest', emoji: '💡', price: 1199, stock: 50,
    description: 'Adjustable LED desk lamp with three brightness levels and a USB port. Ideal for studying and reading.',
    tags: ['lamp', 'desk', 'study', 'led', 'light'], specs: [{ key: 'Power', value: '10 W' }] },
];

async function main() {
  await retry(() => mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:27017/smartcart_products', { serverSelectionTimeoutMS: 5000 }), {
    label: 'mongodb',
  });
  await Product.init(); // make sure the search index exists

  for (const p of products) {
    const { vector, source } = await embeddings.embed(embeddings.buildEmbeddingText(p));
    await Product.findOneAndUpdate(
      { name: p.name },
      { $set: { ...p, isActive: true, embedding: vector, embeddingSource: source } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    log(`seeded: ${p.name} (embedding: ${source})`);
  }

  // Remove old cached copies so the new data shows up straight away
  try {
    const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', { maxRetriesPerRequest: 1 });
    const cache = createCache(redis);
    for (const pattern of ['product:*', 'products:list:*', 'recs:*']) await cache.deleteByPattern(pattern);
    await redis.quit();
    log('old cache entries cleared');
  } catch (err) {
    log(`could not clear cache (${err.message}), it will refresh by itself`);
  }

  log(`done: ${products.length} products`);
  await mongoose.disconnect();
}

main().catch((err) => {
  log('seed failed:', err.message);
  process.exit(1);
});
