/**
 * vault-delete.ts — Safely delete a vault file (with protection for core identity notes)
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { deleteVaultFile, toolError } from './vault-fs.js';

type VaultDeleteInput = { filePath: string };
type VaultDeleteOutput =
  | { success: true; path: string; message: string }
  | { success: false; error: string };

export const vaultDelete: Tool<VaultDeleteInput, VaultDeleteOutput> = tool({
  description: 'Delete a file from the vault. Core identity notes (SOUL.md, USER.md, MEMORY.md, etc.) are protected from deletion.',
  inputSchema: z.object({
    filePath: z.string().min(1).max(1024).describe('Relative path within the vault to delete, e.g. "Work/projects/old-notes.md"'),
  }),
  execute: async ({ filePath }) => {
    try {
      await deleteVaultFile(filePath);
      return {
        success: true,
        path: filePath,
        message: `Successfully deleted vault file "${filePath}".`,
      };
    } catch (error) {
      return { success: false, error: toolError('Delete', filePath, error) };
    }
  },
});
