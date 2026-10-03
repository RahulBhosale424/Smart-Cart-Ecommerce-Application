// MongoDB model for a product. MongoDB fits products well because every
// category has different details (a phone has RAM, a shirt has a size...).

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, default: 'general', index: true },
    brand: { type: String, default: '' },
    tags: { type: [String], default: [] },
    emoji: { type: String, default: '📦' },
    stock: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    specs: { type: [{ _id: false, key: String, value: String }], default: [] },
    // Recommendation data. "select: false" = not returned unless we ask for it.
    embedding: { type: [Number], select: false },
    embeddingSource: { type: String, select: false },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
