import assert from 'node:assert/strict';
import { embedTexts, embeddingModelName } from './memory/embeddings.js';

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((total, value, index) => total + value * right[index], 0);
  const leftMagnitude = Math.sqrt(left.reduce((total, value) => total + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((total, value) => total + value * value, 0));
  return dot / (leftMagnitude * rightMagnitude);
}

const vectors = await embedTexts([
  'Cycling and public transit are alternatives to driving to work.',
  'How can I get to the office without relying on a car?',
  'How do I bake sourdough bread using a flour starter?',
]);
assert.equal(vectors.length, 3);
assert.equal(vectors[0].length, 384, 'all-minilm:l6-v2 must produce 384-dimensional vectors');
assert.ok(vectors.every((vector) => vector.length === 384));
assert.ok(vectors.every((vector) => vector.every(Number.isFinite)));
const relatedSimilarity = cosine(vectors[0], vectors[1]);
const unrelatedSimilarity = cosine(vectors[0], vectors[2]);
assert.ok(relatedSimilarity > unrelatedSimilarity, 'the embedding model should bring paraphrases closer than unrelated subjects');
console.log(`Embedding check passed: ${embeddingModelName()} (${vectors[0].length} dimensions; related=${relatedSimilarity.toFixed(3)}, unrelated=${unrelatedSimilarity.toFixed(3)}).`);
