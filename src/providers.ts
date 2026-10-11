/**
 * providers.ts — Multi-provider model registry
 * 
 * Currently supports Ollama on lab52. Online providers are not wired yet.
 * Select the configured model with ACTIVE_MODEL, e.g. "ollama:qwen2.5:14b".
 */

import { createOllama } from 'ollama-ai-provider-v2';
import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

// ─── Ollama Provider (→ configured via OLLAMA_BASE_URL) ─────────
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api';
export const DEFAULT_EMBEDDING_MODEL = 'all-minilm:l6-v2';
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

const ollama = createOllama({
  baseURL: ollamaBaseUrl,
});

// ─── Model Resolver ─────────────────────────────────────────────
export function getLanguageModel(): LanguageModel {
  const activeModel = process.env.ACTIVE_MODEL || 'ollama:qwen2.5:14b';
  const [provider, ...modelParts] = activeModel.split(':');
  const modelName = modelParts.join(':'); // Handle colons in model names like "qwen2.5:14b"

  switch (provider) {
    case 'ollama': {
      const numCtx = Number.parseInt(process.env.OLLAMA_NUM_CTX || '16384', 10);
      if (!Number.isSafeInteger(numCtx) || numCtx < 1) {
        throw new Error('OLLAMA_NUM_CTX must be a positive integer.');
      }
      const temperature = Number.parseFloat(process.env.OLLAMA_TEMPERATURE || '0');
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        throw new Error('OLLAMA_TEMPERATURE must be a number between 0 and 2.');
      }
      return ollama.chat(modelName || 'qwen2.5:14b', {
        options: { num_ctx: numCtx, temperature },
      });
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required when using the "openai" provider.');
      }
      const openai = createOpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL,
      });
      return openai(modelName || 'gpt-4o');
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Use "ollama:model" or "openai:model"`);
  }
}

// ─── Embedding Model (for Phase 5 RAG) ─────────────────────────
export function getEmbeddingModel(): EmbeddingModel {
  return ollama.textEmbeddingModel(
    DEFAULT_EMBEDDING_MODEL,
    { truncate: false },
  );
}

// ─── Health Check ───────────────────────────────────────────────
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const baseUrl = ollamaBaseUrl.replace(/\/+$/, '');
    const response = await fetch(new URL('tags', `${baseUrl}/`), {
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export { ollama, ollamaBaseUrl };
