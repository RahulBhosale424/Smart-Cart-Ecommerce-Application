const test = require('node:test');
const assert = require('node:assert');
const { localEmbedding, cosine, topSimilar, buildEmbeddingText } = require('../src/embeddings');

test('identical vectors have similarity 1, unrelated have 0', () => {
  assert.equal(Math.round(cosine([1, 0, 0], [1, 0, 0]) * 100) / 100, 1);
  assert.equal(cosine([1, 0, 0], [0, 1, 0]), 0);
});

test('cosine handles empty or different-sized vectors safely', () => {
  assert.equal(cosine([], []), 0);
  assert.equal(cosine([1, 2], [1, 2, 3]), 0);
  assert.equal(cosine([0, 0], [0, 0]), 0);
});

test('products about the same thing are more similar than unrelated ones', () => {
  const headphones = localEmbedding('Wireless Bluetooth headphones with noise cancelling for music');
  const earbuds = localEmbedding('Bluetooth wireless earbuds for music and calls');
  const shoes = localEmbedding('Leather casual sneakers for everyday wear');
  assert.ok(cosine(headphones, earbuds) > cosine(headphones, shoes));
});

test('topSimilar returns the best matches first and respects the limit', () => {
  const target = localEmbedding('wireless bluetooth headphones');
  const candidates = [
    { name: 'shoes', embedding: localEmbedding('leather sneakers shoes') },
    { name: 'earbuds', embedding: localEmbedding('wireless bluetooth earbuds') },
    { name: 'speaker', embedding: localEmbedding('bluetooth speaker wireless') },
  ];
  const result = topSimilar(target, candidates, { limit: 2, min: 0.1 });
  assert.equal(result.length, 2);
  assert.ok(result[0].score >= result[1].score);
  assert.notEqual(result[0].name, 'shoes');
});

test('topSimilar ignores vectors of a different size', () => {
  const result = topSimilar([1, 0], [{ name: 'x', embedding: [1, 0, 0] }], { min: 0 });
  assert.equal(result.length, 0);
});

test('buildEmbeddingText joins the useful fields', () => {
  const text = buildEmbeddingText({ name: 'A', category: 'b', description: 'c', tags: ['d', 'e'] });
  assert.equal(text, 'A. b. c. d e');
});
