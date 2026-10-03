// HTTP routes of the product service.
//   /products/...   public API (reached through the gateway)
//   /internal/...   only for other services (NOT exposed by the gateway)

const express = require('express');
const mongoose = require('mongoose');
const stock = require('./stock');
const { log } = require('./util');

const MIN_SIMILARITY = Number(process.env.MIN_SIMILARITY) || 0.25;
const isAdmin = (req) => req.headers['x-user-role'] === 'admin';

// What the outside world sees of a product
function toDto(p) {
  return {
    id: String(p._id),
    name: p.name,
    description: p.description,
    price: p.price,
    category: p.category,
    brand: p.brand,
    tags: p.tags,
    emoji: p.emoji,
    stock: p.stock,
    specs: p.specs,
  };
}

const EDITABLE = ['name', 'description', 'price', 'category', 'brand', 'tags', 'emoji', 'stock', 'isActive', 'specs'];
function pickEditable(body = {}) {
  const data = {};
  for (const field of EDITABLE) if (body[field] !== undefined) data[field] = body[field];
  return data;
}

function createRouters({ Product, cache, embeddings }) {
  const router = express.Router();
  const internal = express.Router();
  const TTL = cache.TTL;

  // ---------- Product list (cached) ----------
  router.get('/', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
      const category = typeof req.query.category === 'string' ? req.query.category : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const load = async () => {
        const filter = { isActive: true };
        if (category) filter.category = category;
        if (q) filter.$text = { $search: q };
        const [items, total] = await Promise.all([
          Product.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
          Product.countDocuments(filter),
        ]);
        return { products: items.map(toDto), total, page, totalPages: Math.ceil(total / limit) };
      };

      // Free-text searches are too varied to cache, normal lists are cached
      if (q) {
        res.set('X-Cache', 'BYPASS');
        return res.json(await load());
      }
      const { value, cache: state } = await cache.getOrSet(`products:list:${page}:${limit}:${category}`, TTL.list, load);
      res.set('X-Cache', state);
      res.json(value);
    } catch (err) {
      log('list error:', err.message);
      res.status(500).json({ message: 'Could not load products.' });
    }
  });

  router.get('/categories', async (req, res) => {
    try {
      const { value } = await cache.getOrSet('products:list:categories', TTL.list, async () =>
        (await Product.distinct('category', { isActive: true })).sort()
      );
      res.json({ categories: value });
    } catch (err) {
      log('categories error:', err.message);
      res.status(500).json({ message: 'Could not load categories.' });
    }
  });

  // ---------- Trending leaderboard (Redis Sorted Set) ----------
  router.get('/trending', async (req, res) => {
    try {
      const top = await cache.topTrending(8);
      const ids = top.map((t) => t.id).filter((id) => mongoose.isValidObjectId(id));
      if (!ids.length) return res.json({ products: [] });
      const docs = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const products = top.filter((t) => byId.has(t.id)).map((t) => ({ ...toDto(byId.get(t.id)), views: t.views }));
      res.json({ products });
    } catch (err) {
      log('trending error:', err.message);
      res.status(500).json({ message: 'Could not load trending products.' });
    }
  });

  // ---------- Cache statistics (used to measure the "database load" saving) ----------
  router.get('/stats/cache', async (req, res) => {
    try {
      res.json(await cache.getStats());
    } catch {
      res.status(503).json({ message: 'Cache statistics are not available.' });
    }
  });

  // ---------- Recommendations ----------
  router.get('/:id/recommendations', async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Product not found.' });
    try {
      const load = async () => {
        const target = await Product.findOne({ _id: id, isActive: true }).select('+embedding');
        if (!target) return null;
        const candidates = await Product.find({ _id: { $ne: id }, isActive: true }).select('+embedding').lean();

        let picked = [];
        if (target.embedding && target.embedding.length) {
          picked = embeddings.topSimilar(target.embedding, candidates, { limit: 4, min: MIN_SIMILARITY });
        }
        let method = 'similarity';
        // Not enough similar products? Fill up with products from the same category.
        if (picked.length < 2) {
          const already = new Set(picked.map((p) => String(p._id)));
          const sameCategory = candidates
            .filter((c) => c.category === target.category && !already.has(String(c._id)))
            .slice(0, 4 - picked.length)
            .map((c) => ({ ...c, score: null }));
          picked = picked.concat(sameCategory);
          method = 'similarity+category';
        }
        return { method, recommendations: picked.map((p) => ({ ...toDto(p), similarity: p.score })) };
      };

      const { value, cache: state } = await cache.getOrSet(`recs:${id}`, TTL.recommendations, load);
      if (!value) return res.status(404).json({ message: 'Product not found.' });
      res.set('X-Cache', state);
      res.json(value);
    } catch (err) {
      log('recommendations error:', err.message);
      // Recommendations are a bonus feature, so failing quietly is better than an error page
      res.json({ method: 'unavailable', recommendations: [] });
    }
  });

  // ---------- Single product (cached + counts a view for trending) ----------
  router.get('/:id', async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Product not found.' });
    try {
      const { value, cache: state } = await cache.getOrSet(`product:${id}`, TTL.product, async () => {
        const p = await Product.findOne({ _id: id, isActive: true }).lean();
        return p ? toDto(p) : null;
      });
      if (!value) return res.status(404).json({ message: 'Product not found.' });
      cache.trackView(id); // fire and forget
      res.set('X-Cache', state);
      res.json(value);
    } catch (err) {
      log('get product error:', err.message);
      res.status(500).json({ message: 'Could not load the product.' });
    }
  });

  // ---------- Admin: create and update ----------
  router.post('/', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admins only.' });
    const data = pickEditable(req.body);
    if (!data.name || typeof data.price !== 'number' || data.price < 0) {
      return res.status(400).json({ message: 'name and a numeric price are required.' });
    }
    try {
      const { vector, source } = await embeddings.embed(embeddings.buildEmbeddingText(data));
      const product = await Product.create({ ...data, embedding: vector, embeddingSource: source });
      await cache.invalidateProducts([]);
      res.status(201).json(toDto(product));
    } catch (err) {
      log('create product error:', err.message);
      res.status(400).json({ message: 'Could not create the product. Check the fields.' });
    }
  });

  router.put('/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admins only.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Product not found.' });
    try {
      const data = pickEditable(req.body);
      const current = await Product.findById(req.params.id);
      if (!current) return res.status(404).json({ message: 'Product not found.' });
      Object.assign(current, data);
      // The description may have changed, so recalculate the recommendation numbers
      const { vector, source } = await embeddings.embed(embeddings.buildEmbeddingText(current));
      current.embedding = vector;
      current.embeddingSource = source;
      await current.save();
      await cache.invalidateProducts([req.params.id]);
      res.json(toDto(current));
    } catch (err) {
      log('update product error:', err.message);
      res.status(400).json({ message: 'Could not update the product.' });
    }
  });

  // ---------- Internal API for the order service ----------
  internal.post('/reserve', async (req, res) => {
    try {
      const result = await stock.reserveItems(Product, req.body && req.body.items);
      if (!result.ok) {
        return res.status(409).json({
          message: `Sorry, "${result.name}" does not have enough stock.`,
          productId: result.productId,
          available: result.available,
        });
      }
      await cache.invalidateProducts(result.items.map((i) => i.productId));
      res.json({ items: result.items });
    } catch (err) {
      if (err.message === 'Invalid item in list' || err.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid items.' });
      }
      log('reserve error:', err.message);
      res.status(500).json({ message: 'Could not reserve stock.' });
    }
  });

  internal.post('/release', async (req, res) => {
    try {
      const items = (req.body && req.body.items) || [];
      await stock.releaseItems(Product, items);
      await cache.invalidateProducts(items.map((i) => i.productId));
      res.json({ ok: true });
    } catch (err) {
      log('release error:', err.message);
      res.status(500).json({ message: 'Could not release stock.' });
    }
  });

  return { router, internal };
}

module.exports = { createRouters, toDto };
