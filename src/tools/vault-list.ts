/**
 * vault-list.ts — List vault directory contents
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { listVaultDirectory, toolError } from './vault-fs.js';

type VaultListInput = { dirPath: string };
type VaultListOutput =
  | { success: true; path: string; items: Array<{ name: string; type: 'directory' | 'file' }>; count: number }
  | { success: false; error: string };

export const vaultList: Tool<VaultListInput, VaultListOutput> = tool({
  description: 'List files and folders in a vault directory. Use "" or "." for the vault root. Use paths like "Knowledgebase/concepts" to list subdirectories.',
  inputSchema: z.object({
    dirPath: z.string().max(1024).default('.').describe('Relative directory path within the vault, e.g. ".", "Knowledgebase", or "Work/projects"'),
  }),
  execute: async ({ dirPath }) => {
    try {
      const items = await listVaultDirectory(dirPath);

      return { 
        success: true, 
        path: dirPath || '.',
        items,
        count: items.length,
      };
    } catch (error) {
      return { success: false, error: toolError('List', dirPath, error) };
    }
  },
});
