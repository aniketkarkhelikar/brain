/** Runs the evidence-led memory audit over the local Markdown vault. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { runMemoryAudit } from '../heartbeat/memory-audit.js';

type MemoryAuditInput = { maxFiles?: number };

export const memoryAudit: Tool<MemoryAuditInput, Awaited<ReturnType<typeof runMemoryAudit>>> = tool({
  description: 'Run the local AI memory audit for the vault. Check always-loaded memory and explicit Current State notes against exact dated evidence. The audit may automatically correct only high-confidence contradictions with a unique exact target line and newer quoted evidence; it preserves the old line in that note’s Log and appends the action to the vault log. Unsupported or unclear claims remain in the review report. Use when the user asks to audit, lint, check for stale facts, or fix memory contradictions.',
  inputSchema: z.object({
    maxFiles: z.number().int().min(1).max(500).optional().describe('Maximum number of current-state notes to audit in this run. Always-loaded files are prioritized.'),
  }),
  execute: async ({ maxFiles }) => runMemoryAudit({ force: true, autoFix: true, maxFiles }),
});
