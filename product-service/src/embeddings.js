// Product recommendations using "embeddings".
//
// An embedding is a list of numbers that describes the MEANING of a text.
// Two products with similar meaning get similar numbers, so we can find
// "products like this one" by comparing the numbers (cosine similarity).
//
// With OPENAI_API_KEY set, OpenAI's embedding model creates the numbers.
// Without a key (or if OpenAI fails) a simple word-count fallback is used,
// so the app still runs offline. The fallback is NOT AI, it only matches shared words.

const { log } = require('./util');

const FALLBACK_DIMENSIONS = 256;

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Turns a word into a number between 0 and 255 (same word -> same number)
function hashWord(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % FALLBACK_DIMENSIONS;
}

function normalize(vector) {
  const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return length === 0 ? vector : vector.map((x) => x / length);
}

// Fallback embedding: count words into 256 buckets
function localEmbedding(text) {
  const vector = new Array(FALLBACK_DIMENSIONS).fill(0);
  for (const word of tokenize(text)) vector[hashWord(word)] += 1;
  return normalize(vector);
}

// Cosine similarity: 1 = same meaning, 0 = unrelated
function cosine(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// The text we describe a product with
function buildEmbeddingText(product) {
  return [product.name, product.category, product.brand, product.description, (product.tags || []).join(' ')]
    .filter(Boolean)
    .join('. ');
}

async function openaiEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`OpenAI returned status ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding;
}

// Never throws: if OpenAI is unavailable we fall back to the local method.
async function embed(text) {
  if (process.env.OPENAI_API_KEY) {
    try {
      return { vector: await openaiEmbedding(text), source: 'openai' };
    } catch (err) {
      log(`OpenAI embedding failed (${err.message}). Using local fallback.`);
    }
  }
  return { vector: localEmbedding(text), source: 'local' };
}

// Best matches for "target", highest similarity first.
// Only vectors of the same size are compared (OpenAI and local vectors differ in size).
function topSimilar(targetVector, candidates, { limit = 4, min = 0.2 } = {}) {
  return candidates
    .filter((c) => c.embedding && c.embedding.length === targetVector.length)
    .map((c) => ({ ...c, score: Math.round(cosine(targetVector, c.embedding) * 1000) / 1000 }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { embed, localEmbedding, cosine, buildEmbeddingText, topSimilar, tokenize };
