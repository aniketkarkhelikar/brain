/** Targeted exact-text edits that preserve the rest of a Markdown note. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { patchVaultFile, toolError } from './vault-fs.js';

const schema = z.object({
  filePath: z.string().min(1).max(1024).describe('Relative Markdown path inside the vault.'),
  search: z.string().min(1).max(100_000).describe('Exact text that must currently appear in the note.'),
  replace: z.string().max(100_000).describe('Replacement text.'),
  allowMultiple: z.boolean().default(false).describe('Explicitly replace every occurrence. Default requires one unique match.'),
});

type PatchInput = z.infer<typeof schema>;
type PatchOutput = { success: true; path: string; replacements: number } | { success: false; error: string };

export const vaultPatch: Tool<PatchInput, PatchOutput> = tool({
  description: 'Apply a precise find-and-replace edit to an existing vault note. It requires an exact match and, by default, exactly one occurrence; it refuses stale or ambiguous edits.',
  inputSchema: schema,
  execute: async ({ filePath, search, replace, allowMultiple }) => {
    try {
      const result = await patchVaultFile(filePath, search, replace, allowMultiple);
      return { success: true, path: filePath, replacements: result.replacements };
    } catch (error) {
      return { success: false, error: toolError('Patch', filePath, error) };
    }
  },
});
