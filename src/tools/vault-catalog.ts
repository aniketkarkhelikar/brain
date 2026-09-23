/** Read the generated human-readable catalog as a deterministic inventory route. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { readVaultFile, toolError } from './vault-fs.js';

type VaultCatalogOutput =
  | { success: true; path: 'index.md'; content: string }
  | { success: false; error: string };

export async function readVaultCatalog(): Promise<VaultCatalogOutput> {
  try {
    return { success: true, path: 'index.md', content: await readVaultFile('index.md') };
  } catch (error) {
    return { success: false, error: toolError('Read catalog', 'index.md', error) };
  }
}

export const vaultCatalog: Tool<Record<string, never>, VaultCatalogOutput> = tool({
  description: 'Read the complete generated vault catalog. Use this first for broad inventory questions such as what notes, projects, people, or files exist.',
  inputSchema: z.object({}),
  execute: async () => readVaultCatalog(),
});
