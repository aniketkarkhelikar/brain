/**
 * vault-read.ts — Read files from the vault
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { readVaultFile, toolError } from './vault-fs.js';

type VaultReadInput = { filePath: string };
type VaultReadOutput =
  | { success: true; path: string; content: string; charCount: number }
  | { success: false; error: string };

export const vaultRead: Tool<VaultReadInput, VaultReadOutput> = tool({
  description: 'Read a file from the vault. Use relative paths like "MEMORY.md" or "Work/projects/myproject.md".',
  inputSchema: z.object({
    filePath: z.string().min(1).max(1024).describe('Relative path within the vault, e.g. "MEMORY.md" or "Knowledgebase/concepts/RAG.md"'),
  }),
  execute: async ({ filePath }) => {
    try {
      const content = await readVaultFile(filePath);
      return { success: true, path: filePath, content, charCount: content.length };
    } catch (error) {
      return { success: false, error: toolError('Read', filePath, error) };
    }
  },
});
