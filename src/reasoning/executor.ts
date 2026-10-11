/**
 * executor.ts — Step-by-Step Isolated Task Executor (Phase 2C)
 *
 * Runs each planned sub-task in isolated context to prevent local LLM (qwen2.5:14b)
 * recency bias, tool output poisoning, and premature termination.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateText } from 'ai';
import { getLanguageModel } from '../providers.js';
import { performDdgSearch, type WebSearchResultItem } from '../tools/web-search.js';
import { findNoteConnections } from './note-connector.js';
import { searchVault } from '../memory/search.js';
import type { PlanStep } from './planner.js';

export interface StepExecutionResult {
  step: PlanStep;
  success: boolean;
  content: string;
  sources?: string[];
  error?: string;
}

export async function executePlanStep(
  step: PlanStep,
  vaultPath: string
): Promise<StepExecutionResult> {
  const model = getLanguageModel();

  switch (step.kind) {
    case 'vault_profile': {
      // 1. Read USER.md, SOUL.md, MEMORY.md directly
      let userMd = '';
      let soulMd = '';
      let memoryMd = '';
      try {
        userMd = await fs.readFile(path.join(vaultPath, 'USER.md'), 'utf8');
      } catch { /* optional */ }
      try {
        soulMd = await fs.readFile(path.join(vaultPath, 'SOUL.md'), 'utf8');
      } catch { /* optional */ }
      try {
        memoryMd = await fs.readFile(path.join(vaultPath, 'MEMORY.md'), 'utf8');
      } catch { /* optional */ }

      const prompt = [
        `You are the user's personal Second Brain. Based strictly on the user profile notes below, synthesize a comprehensive, warm, and accurate overview of who the user is.`,
        '',
        `=== USER.md ===`,
        userMd || '(No USER.md found)',
        '',
        `=== SOUL.md ===`,
        soulMd || '(No SOUL.md found)',
        '',
        `=== MEMORY.md ===`,
        memoryMd || '(No MEMORY.md found)',
        '',
        `Instructions:`,
        `- Include their name, current role/focus, location/timezone, schedule, active projects, and working preferences.`,
        `- Be structured and concise using markdown bullet points.`,
        `- Never claim information is missing if it is present above.`,
      ].join('\n');

      try {
        const res = await generateText({ model, prompt, temperature: 0.1 });
        return {
          step,
          success: true,
          content: res.text,
          sources: ['vault/USER.md', 'vault/SOUL.md', 'vault/MEMORY.md'],
        };
      } catch (err) {
        return {
          step,
          success: false,
          content: `Unable to synthesize profile: ${err instanceof Error ? err.message : String(err)}`,
          error: String(err),
        };
      }
    }

    case 'connections': {
      try {
        const analysis = await findNoteConnections(vaultPath);
        return {
          step,
          success: true,
          content: analysis,
        };
      } catch (err) {
        return {
          step,
          success: false,
          content: `Failed to analyze connections: ${err instanceof Error ? err.message : String(err)}`,
          error: String(err),
        };
      }
    }

    case 'web_search': {
      try {
        // Run live DuckDuckGo web search
        const results = await performDdgSearch(step.query, 5);

        if (!results || results.length === 0) {
          return {
            step,
            success: true,
            content: `No live search results were found on the web for "${step.query}".`,
          };
        }

        // Synthesize the web search results cleanly
        const resultsContext = results
          .map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`)
          .join('\n\n');

        const prompt = [
          `You are an AI research assistant. Synthesize the latest live web search results below to answer the user query: "${step.query}".`,
          '',
          `Web Search Results:`,
          resultsContext,
          '',
          `Instructions:`,
          `- Provide a clear summary of what is happening based on these latest updates.`,
          `- Include markdown links to the sources [Source Name](URL) so the user can verify them.`,
          `- Be factual, neutral, and up-to-date.`,
        ].join('\n');

        const res = await generateText({ model, prompt, temperature: 0.2 });

        return {
          step,
          success: true,
          content: res.text,
          sources: results.map((r) => r.url),
        };
      } catch (err) {
        return {
          step,
          success: false,
          content: `Web search encountered an error: ${err instanceof Error ? err.message : String(err)}`,
          error: String(err),
        };
      }
    }

    case 'vault_query': {
      try {
        const searchRes = await searchVault(step.query, 5);
        if (searchRes.results.length === 0) {
          return {
            step,
            success: true,
            content: `No specific notes matching "${step.query}" were found in your vault.`,
          };
        }

        const snippets = searchRes.results
          .map((r) => `- **${r.title}** (\`${r.path}\`):\n  ${r.snippet}`)
          .join('\n\n');

        const prompt = [
          `Answer the user question "${step.query}" using ONLY the vault notes below:`,
          '',
          snippets,
          '',
          `Be concise and reference the relevant note paths.`,
        ].join('\n');

        const res = await generateText({ model, prompt, temperature: 0.1 });

        return {
          step,
          success: true,
          content: res.text,
          sources: searchRes.results.map((r) => r.path),
        };
      } catch (err) {
        return {
          step,
          success: false,
          content: `Vault search error: ${err instanceof Error ? err.message : String(err)}`,
          error: String(err),
        };
      }
    }

    case 'general':
    default: {
      try {
        const prompt = step.query;
        const res = await generateText({ model, prompt, temperature: 0.3 });
        return {
          step,
          success: true,
          content: res.text,
        };
      } catch (err) {
        return {
          step,
          success: false,
          content: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
          error: String(err),
        };
      }
    }
  }
}
