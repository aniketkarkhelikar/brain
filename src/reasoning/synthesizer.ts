/**
 * synthesizer.ts — Structured Output Synthesis & Streaming (Phase 2C)
 *
 * Formats validated execution results into a unified, cleanly structured
 * response and produces an async token stream for UI/CLI consumption.
 */

import type { ExecutionPlan } from './planner.js';
import type { StepExecutionResult } from './executor.js';

export function synthesizePlanResults(
  plan: ExecutionPlan,
  results: StepExecutionResult[]
): string {
  if (results.length === 0) {
    return 'I processed your request, but no response content was generated.';
  }

  // 1. Single Task or Simple Intent: Direct Clean Output
  if (!plan.isCompound || results.length === 1) {
    return results[0].content.trim();
  }

  // 2. Compound Multi-Task: Enforce Structured Headings
  const sections: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const stepNum = i + 1;
    const title = res.step.title || `Task ${stepNum}`;

    sections.push(`### Task ${stepNum}: ${title}\n\n${res.content.trim()}`);
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Converts a synthesized markdown string into an AsyncIterable stream of tokens
 * for the UI server (SSE deltas) and CLI chat streaming.
 */
export async function* createTokenStream(text: string): AsyncIterable<string> {
  // Yield words and whitespace smoothly to simulate live generation
  const tokens = text.match(/\S+|\s+/g) || [text];
  for (const token of tokens) {
    yield token;
    // Small micro-yield so the event loop can dispatch SSE chunks
    await new Promise((resolve) => setImmediate(resolve));
  }
}
