import { embedMany } from 'ai';
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL, getEmbeddingModel } from '../providers.js';

export { DEFAULT_EMBEDDING_MODEL };

export function embeddingModelName(): string {
  return DEFAULT_EMBEDDING_MODEL;
}

export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values,
    maxRetries: 1,
    maxParallelCalls: 1,
  });
  if (embeddings.length !== values.length) {
    throw new Error(`Embedding model returned ${embeddings.length} vectors for ${values.length} inputs.`);
  }
  const dimensions = embeddings[0]?.length;
  if (!dimensions || embeddings.some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error('Embedding model returned empty, inconsistent, or non-finite vectors.');
  }
  if (dimensions !== DEFAULT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Ollama ${DEFAULT_EMBEDDING_MODEL} must return ${DEFAULT_EMBEDDING_DIMENSIONS}-dimensional vectors; received ${dimensions}.`,
    );
  }
  return embeddings;
}
