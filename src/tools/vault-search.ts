/** Search exact words and semantically related passages in the indexed vault. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { searchVault, type HybridSearchResult } from '../memory/search.js';
import { readVaultFileIfSmall } from './vault-fs.js';

type VaultSearchInput = { query: string; maxResults: number };
export type VaultSearchOutput = HybridSearchResult | { success: false; error: string };
export type VaultSearchService = (query: string, maxResults: number) => Promise<HybridSearchResult>;

async function addSmallCandidateText(result: HybridSearchResult): Promise<HybridSearchResult> {
  let remainingChars = 12_000;
  for (const candidate of result.results.slice(0, 3)) {
    try {
      const content = await readVaultFileIfSmall(candidate.path, Math.min(5_000, remainingChars));
      if (content !== undefined) {
        candidate.documentContent = content;
        candidate.contentMode = 'full-document';
        remainingChars -= content.length;
      } else {
        candidate.contentMode = 'matching-passages';
      }
    } catch {
      candidate.contentMode = 'matching-passages';
    }
  }
  return result;
}

export async function runVaultSearch(query: string, maxResults = 10): Promise<VaultSearchOutput> {
  try {
    return await addSmallCandidateText(await searchVault(query, maxResults));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Vault search failed.' };
  }
}

export function createVaultSearchTool(search: VaultSearchService = searchVault): Tool<VaultSearchInput, VaultSearchOutput> {
  return tool({
    description: 'Search the file catalog and all note chunks using exact keyword matching and semantic similarity. The search incrementally indexes changed Markdown files, returns matching passages, and includes the full text of up to three small candidate notes. For large notes, use the returned passages or read a result by copying its case-sensitive path unchanged into vaultRead.filePath.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('A question or topic to find in the vault; exact names and paraphrases are both supported.'),
      maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum number of matching files to return'),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        return await addSmallCandidateText(await search(query, maxResults));
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Vault search failed.' };
      }
    },
  });
}

export const vaultSearch = createVaultSearchTool();
