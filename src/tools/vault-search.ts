/**
 * vault-search.ts — Search vault files by keyword (grep-style)
 * Phase 3 basic version. Upgrades to hybrid vector+keyword in Phase 5.
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { searchVaultFiles, toolError } from './vault-fs.js';

type VaultSearchInput = { query: string; maxResults: number };
type VaultSearchOutput =
  | { success: true; query: string; totalMatches: number; truncated: boolean; results: Array<{ file: string; matches: string[] }> }
  | { success: false; error: string };

export const vaultSearch: Tool<VaultSearchInput, VaultSearchOutput> = tool({
  description: 'Search all vault markdown files for a keyword or phrase. Returns matching file paths and snippets containing the search term.',
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200).describe('The keyword or phrase to search for (case-insensitive)'),
    maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum number of matching files to return'),
  }),
  execute: async ({ query, maxResults }) => {
    try {
      const { totalMatches, results } = await searchVaultFiles(query, maxResults);
      return {
        success: true,
        query,
        totalMatches,
        truncated: totalMatches > results.length,
        results,
      };
    } catch (error) {
      return { success: false, error: toolError('Search', query, error) };
    }
  },
});
