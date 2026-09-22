/**
 * vault-write.ts — Write or append to vault files
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || './vault';

export const vaultWrite = tool({
  description: 'Write content to a vault file. Can create new files or overwrite existing ones. Use mode "append" to add to existing files (e.g. daily logs).',
  parameters: z.object({
    filePath: z.string().describe('Relative path within the vault, e.g. "Knowledgebase/concepts/RAG.md" or "daily/2026-09-23.md"'),
    content: z.string().describe('The markdown content to write'),
    mode: z.enum(['write', 'append']).default('write').describe('"write" to create/overwrite, "append" to add to end of file'),
  }),
  execute: async ({ filePath, content, mode }) => {
    try {
      const fullPath = path.join(VAULT_PATH, filePath);
      
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      
      if (mode === 'append') {
        await fs.appendFile(fullPath, '\n' + content);
      } else {
        await fs.writeFile(fullPath, content);
      }
      
      const stats = await fs.stat(fullPath);
      return { 
        success: true, 
        path: filePath, 
        mode, 
        bytesWritten: stats.size,
      };
    } catch (err: any) {
      return { success: false, error: `Cannot write ${filePath}: ${err.message}` };
    }
  },
});
