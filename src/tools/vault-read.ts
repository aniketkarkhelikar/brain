/**
 * vault-read.ts — Read files from the vault
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || './vault';

export const vaultRead = tool({
  description: 'Read a file from the vault. Use relative paths like "MEMORY.md" or "Work/projects/myproject.md".',
  parameters: z.object({
    filePath: z.string().describe('Relative path within the vault, e.g. "MEMORY.md" or "Knowledgebase/concepts/RAG.md"'),
  }),
  execute: async ({ filePath }) => {
    try {
      const fullPath = path.join(VAULT_PATH, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, path: filePath, content, charCount: content.length };
    } catch (err: any) {
      return { success: false, error: `Cannot read ${filePath}: ${err.message}` };
    }
  },
});
