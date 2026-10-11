/**
 * scratchpad-read.ts — Tool for reading offloaded scratchpad content.
 * Part of the Memory Pointer Pattern: allows the agent to inspect large
 * payloads that were offloaded to disk to preserve context window.
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { readScratchpad } from '../reasoning/scratchpad.js';

const scratchpadReadSchema = z.object({
  scratchPath: z
    .string()
    .min(1)
    .describe('The relative scratchpad file path, e.g. "state/scratch/webRead_123456.md"'),
  startChar: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Character offset to start reading from (default 0)'),
  maxChars: z
    .number()
    .int()
    .min(100)
    .max(10_000)
    .default(5_000)
    .describe('Maximum number of characters to read in this step (default 5,000)'),
});

type ScratchpadReadInput = z.infer<typeof scratchpadReadSchema>;
type ScratchpadReadOutput =
  | {
      success: true;
      scratchPath: string;
      content?: string;
      totalChars?: number;
      hasMore: boolean;
    }
  | {
      success: false;
      scratchPath: string;
      error: string;
    };

export const scratchpadRead: Tool<ScratchpadReadInput, ScratchpadReadOutput> = tool({
  description:
    'Reads the full content of an offloaded working-memory scratchpad file using its scratchPath pointer. Use when you need to inspect sections of a large web page or document that was offloaded to disk.',
  inputSchema: scratchpadReadSchema,
  execute: async ({ scratchPath, startChar = 0, maxChars = 5_000 }) => {
    const res = await readScratchpad(scratchPath, { startChar, maxChars });
    if (!res.success) {
      return {
        success: false,
        scratchPath,
        error: res.error || 'Failed to read scratchpad.',
      };
    }

    const hasMore = (res.totalChars ?? 0) > startChar + (res.content?.length ?? 0);
    return {
      success: true,
      scratchPath,
      content: res.content,
      totalChars: res.totalChars,
      hasMore,
    };
  },
});
