/**
 * vault-patch.ts — Targeted find-and-replace edit within a vault file
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { patchVaultFile, toolError } from './vault-fs.js';

const patchInputSchema = z.object({
  filePath: z.string().min(1).max(1024).describe('Relative path within the vault, e.g. "Work/projects/FoodTrace.md"'),
  search: z.string().min(1).max(100_000).describe('Exact text substring to search for and replace'),
  replace: z.string().max(100_000).describe('New replacement text'),
  allowMultiple: z.boolean().default(false).describe('Set to true if all instances should be replaced; default false requires unique occurrence'),
});

type VaultPatchInput = z.infer<typeof patchInputSchema>;
type VaultPatchOutput =
  | { success: true; path: string; replacements: number; message: string }
  | { success: false; error: string };

export const vaultPatch: Tool<VaultPatchInput, VaultPatchOutput> = tool({
  description: 'Perform a targeted find-and-replace edit in an existing vault file instead of rewriting the entire document. Preserves surrounding context.',
  inputSchema: patchInputSchema,
  execute: async ({ filePath, search, replace, allowMultiple }) => {
    try {
      const result = await patchVaultFile(filePath, search, replace, allowMultiple);
      return {
        success: true,
        path: filePath,
        replacements: result.replacements,
        message: `Successfully replaced ${result.replacements} occurrence(s) in "${filePath}".`,
      };
    } catch (error) {
      return { success: false, error: toolError('Patch', filePath, error) };
    }
  },
});
