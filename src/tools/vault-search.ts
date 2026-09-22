/**
 * vault-search.ts — Search vault files by keyword (grep-style)
 * Phase 3 basic version. Upgrades to hybrid vector+keyword in Phase 5.
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

const VAULT_PATH = process.env.VAULT_PATH || './vault';

export const vaultSearch = tool({
  description: 'Search all vault markdown files for a keyword or phrase. Returns matching file paths and snippets containing the search term.',
  parameters: z.object({
    query: z.string().describe('The keyword or phrase to search for (case-insensitive)'),
    maxResults: z.number().default(10).describe('Maximum number of matching files to return'),
  }),
  execute: async ({ query, maxResults }) => {
    try {
      const files = await glob('**/*.md', { cwd: VAULT_PATH });
      const results: Array<{ file: string; matches: string[] }> = [];
      const queryLower = query.toLowerCase();

      for (const file of files) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(VAULT_PATH, file);
        const content = await fs.readFile(fullPath, 'utf-8');
        
        if (content.toLowerCase().includes(queryLower)) {
          // Extract matching lines
          const lines = content.split('\n');
          const matchingLines = lines
            .filter(line => line.toLowerCase().includes(queryLower))
            .slice(0, 3) // Max 3 matching lines per file
            .map(line => line.trim());
          
          results.push({ file, matches: matchingLines });
        }
      }

      return { 
        success: true, 
        query, 
        totalMatches: results.length,
        results,
      };
    } catch (err: any) {
      return { success: false, error: `Search failed: ${err.message}` };
    }
  },
});
