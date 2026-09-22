/**
 * vault-list.ts — List vault directory contents
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || './vault';

export const vaultList = tool({
  description: 'List files and folders in a vault directory. Use "" or "." for the vault root. Use paths like "Knowledgebase/concepts" to list subdirectories.',
  parameters: z.object({
    dirPath: z.string().default('.').describe('Relative directory path within the vault, e.g. "Knowledgebase" or "Work/projects"'),
  }),
  execute: async ({ dirPath }) => {
    try {
      const fullPath = path.join(VAULT_PATH, dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const items = entries
        .filter(e => !e.name.startsWith('.')) // Skip hidden files
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));

      return { 
        success: true, 
        path: dirPath || '.',
        items,
        count: items.length,
      };
    } catch (err: any) {
      return { success: false, error: `Cannot list ${dirPath}: ${err.message}` };
    }
  },
});
