/**
 * vault-meta.ts — Read or update YAML frontmatter metadata for a vault file
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { metaVaultFile, toolError } from './vault-fs.js';

type VaultMetaInput = { filePath: string; updates?: Record<string, unknown> };
type VaultMetaOutput =
  | { success: true; path: string; metadata: Record<string, unknown> }
  | { success: false; error: string };

export const vaultMeta: Tool<VaultMetaInput, VaultMetaOutput> = tool({
  description: 'Inspect or update the YAML frontmatter of a vault markdown file (e.g. tags, title, status, dates). Leave updates empty to read current metadata.',
  inputSchema: z.object({
    filePath: z.string().min(1).max(1024).describe('Relative path within the vault, e.g. "Work/projects/FoodTrace.md"'),
    updates: z.record(z.string(), z.unknown()).optional().describe('Key-value pairs to set in the frontmatter. Set a key to null to delete it.'),
  }),
  execute: async ({ filePath, updates }) => {
    try {
      const result = await metaVaultFile(filePath, updates);
      return {
        success: true,
        path: filePath,
        metadata: result.data,
      };
    } catch (error) {
      return { success: false, error: toolError('Meta', filePath, error) };
    }
  },
});
