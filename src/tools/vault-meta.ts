/** Read or update YAML frontmatter without rewriting note content. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { metaVaultFile, toolError } from './vault-fs.js';

type MetaInput = { filePath: string; updates?: Record<string, unknown> };
type MetaOutput = { success: true; path: string; metadata: Record<string, unknown> } | { success: false; error: string };

export const vaultMeta: Tool<MetaInput, MetaOutput> = tool({
  description: 'Inspect or update YAML frontmatter on an existing Markdown note. Omit updates to inspect metadata; set a value to null to remove a key.',
  inputSchema: z.object({
    filePath: z.string().min(1).max(1024).describe('Relative Markdown path inside the vault.'),
    updates: z.record(z.string(), z.unknown()).optional().describe('Frontmatter values to set or remove.'),
  }),
  execute: async ({ filePath, updates }) => {
    try {
      const result = await metaVaultFile(filePath, updates);
      return { success: true, path: filePath, metadata: result.data };
    } catch (error) {
      return { success: false, error: toolError('Metadata', filePath, error) };
    }
  },
});
