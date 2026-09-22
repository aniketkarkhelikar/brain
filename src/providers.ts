/**
 * providers.ts — Multi-provider model registry
 * 
 * Supports: Ollama (lab52 GPU), OpenAI, @ai-sdk/openai-compatible
 * Switch models with ACTIVE_MODEL env var: "ollama:qwen2.5:14b" or "openai:gpt-4o"
 */

import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

// ─── Ollama Provider (→ lab52 GPU server) ───────────────────────
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://172.25.128.20:11434/api';

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
      const numCtx = parseInt(process.env.OLLAMA_NUM_CTX || '16384', 10);
      return ollama(modelName || 'qwen2.5:14b', {
        numCtx,
      });
    }
    case 'openai': {
      // Dynamic import would be needed for @ai-sdk/openai
      // For now, Ollama is the primary provider
      throw new Error(`OpenAI provider not configured yet. Set OPENAI_API_KEY in .env`);
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Use "ollama:model" or "openai:model"`);
  }
}

// ─── Embedding Model (for Phase 5 RAG) ─────────────────────────
export function getEmbeddingModel() {
  return ollama.textEmbeddingModel('bge-m3');
}

// ─── Health Check ───────────────────────────────────────────────
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(ollamaBaseUrl.replace('/api', '/api/tags'));
    return response.ok;
  } catch {
    return false;
  }
}

export { ollama, ollamaBaseUrl };
