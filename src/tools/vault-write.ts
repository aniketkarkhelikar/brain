/**
 * vault-write.ts — Write or append to vault files
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { toolError, writeVaultFile } from './vault-fs.js';

type VaultWriteInput = { filePath: string; content: string; mode: 'write' | 'append' };
type VaultWriteOutput =
  | { success: true; path: string; mode: 'write' | 'append'; bytesWritten: number }
  | { success: false; error: string };

export const vaultWrite: Tool<VaultWriteInput, VaultWriteOutput> = tool({
  description: 'Write content to a vault file. Can create new files or overwrite existing ones. Use mode "append" to add to existing files (e.g. daily logs).',
  inputSchema: z.object({
    filePath: z.string().min(1).max(1024).describe('Relative path within the vault, e.g. "Knowledgebase/concepts/RAG.md" or "daily/2026-09-23.md"'),
    content: z.string().max(5_000_000).describe('The markdown content to write (maximum 5 million characters)'),
    mode: z.enum(['write', 'append']).default('write').describe('"write" to create/overwrite, "append" to add to end of file'),
  }),
  execute: async ({ filePath, content, mode }) => {
    try {
      const bytesWritten = await writeVaultFile(filePath, content, mode);
      return {
        success: true, 
        path: filePath,
        mode,
        bytesWritten,
      };
    } catch (error) {
      return { success: false, error: toolError('Write', filePath, error) };
    }
  },
});
