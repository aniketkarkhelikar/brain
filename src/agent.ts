/**
 * agent.ts — Core Second Brain agent
 * 
 * Uses Vercel AI SDK generateText with multi-step tool execution.
 * Loads SOUL.md + USER.md + MEMORY.md as system context.
 */

import { generateText, streamText, type CoreMessage } from 'ai';
import { getLanguageModel } from './providers.js';
import { vaultRead, vaultWrite, vaultSearch, vaultList } from './tools/index.js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const VAULT_PATH = process.env.VAULT_PATH || './vault';

// ─── Load vault context files ───────────────────────────────────
async function loadVaultContext(): Promise<string> {
  const files = ['SOUL.md', 'USER.md', 'MEMORY.md'];
  const parts: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(VAULT_PATH, file), 'utf-8');
      parts.push(`=== ${file} ===\n${content}`);
    } catch {
      parts.push(`=== ${file} === (not found)`);
    }
  }

  // Also load today's daily log if it exists
  const today = new Date().toISOString().split('T')[0];
  try {
    const dailyLog = await fs.readFile(path.join(VAULT_PATH, `daily/${today}.md`), 'utf-8');
    parts.push(`=== Today's Log (${today}) ===\n${dailyLog}`);
  } catch {
    // No daily log yet — that's fine
  }

  return parts.join('\n\n');
}

// ─── All available tools ────────────────────────────────────────
const allTools = {
  vaultRead,
  vaultWrite,
  vaultSearch,
  vaultList,
};

// ─── Generate response (non-streaming, for heartbeat/background) ─
export async function agentGenerate(
  prompt: string,
  history: CoreMessage[] = [],
  options?: { maxSteps?: number; systemOverride?: string }
): Promise<{ text: string; messages: CoreMessage[] }> {
  const model = getLanguageModel();
  const vaultContext = await loadVaultContext();

  const systemPrompt = options?.systemOverride || 
    `You are an AI Second Brain assistant. You have direct access to the user's vault of markdown files.\n\n${vaultContext}\n\nUse your tools to read, write, search, and list files in the vault. Always search before creating new files to avoid duplicates.`;

  const messages: CoreMessage[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools: allTools,
    maxSteps: options?.maxSteps ?? 5,
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log(`  🔧 ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 80)}...)`);
        }
      }
    },
  });

  return {
    text: result.text,
    messages: result.response.messages as CoreMessage[],
  };
}

// ─── Stream response (for CLI chat) ─────────────────────────────
export async function agentStream(
  prompt: string,
  history: CoreMessage[] = [],
  options?: { maxSteps?: number }
) {
  const model = getLanguageModel();
  const vaultContext = await loadVaultContext();

  const systemPrompt = `You are an AI Second Brain assistant. You have direct access to the user's vault of markdown files.\n\n${vaultContext}\n\nUse your tools to read, write, search, and list files in the vault. Always search before creating new files to avoid duplicates.`;

  const messages: CoreMessage[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: allTools,
    maxSteps: options?.maxSteps ?? 5,
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          process.stdout.write(`\n  🔧 ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 80)})\n`);
        }
      }
    },
  });

  return result;
}

export { loadVaultContext, allTools };
