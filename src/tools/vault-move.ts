/**
 * vault-move.ts — Safely move or rename a file within the vault
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { moveVaultFile, toolError } from './vault-fs.js';

type VaultMoveInput = { sourcePath: string; destinationPath: string };
type VaultMoveOutput =
  | { success: true; sourcePath: string; destinationPath: string; message: string }
  | { success: false; error: string };

export const vaultMove: Tool<VaultMoveInput, VaultMoveOutput> = tool({
  description: 'Move or rename a file within the vault. Automatically ensures the destination directory exists safely.',
  inputSchema: z.object({
    sourcePath: z.string().min(1).max(1024).describe('Current relative path in the vault, e.g. "Inbox/notes/draft.md"'),
    destinationPath: z.string().min(1).max(1024).describe('New relative path in the vault, e.g. "Knowledgebase/concepts/draft.md"'),
  }),
  execute: async ({ sourcePath, destinationPath }) => {
    try {
      await moveVaultFile(sourcePath, destinationPath);
      return {
        success: true,
        sourcePath,
        destinationPath,
        message: `Successfully moved "${sourcePath}" to "${destinationPath}".`,
      };
    } catch (error) {
      return { success: false, error: toolError('Move', sourcePath, error) };
    }
  },
});
