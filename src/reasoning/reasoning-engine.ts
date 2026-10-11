/**
 * reasoning-engine.ts — Master Plan-Execute-Validate Reasoning Engine (Phase 2C)
 *
 * Replaces naive monolithic ReAct loops with a structured cognitive architecture:
 * Plan → Execute (isolated) → Validate → Refine → Synthesize
 */

import type { ModelMessage } from 'ai';
import { createExecutionPlan, type ExecutionPlan } from './planner.js';
import { executePlanStep, type StepExecutionResult } from './executor.js';
import { validateAndRefine } from './validator.js';
import { synthesizePlanResults, createTokenStream } from './synthesizer.js';

export interface ReasoningResult {
  text: string;
  textStream: AsyncIterable<string>;
  responseMessages: Promise<ModelMessage[]>;
  plan: ExecutionPlan;
  results: StepExecutionResult[];
}

export async function runReasoningEngine(
  prompt: string,
  vaultPath: string,
  options?: {
    onStepActivity?: (stepNum: number, title: string) => void;
  }
): Promise<ReasoningResult> {
  // Phase 1: PLAN — Deconstruct user query into structured sub-tasks
  const plan = createExecutionPlan(prompt);

  // Phase 2: EXECUTE — Run each step in isolated context
  const stepResults: StepExecutionResult[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    options?.onStepActivity?.(step.id, step.title);
    const result = await executePlanStep(step, vaultPath);
    stepResults.push(result);
  }

  // Phase 3: VALIDATE & REFINE — Check completeness and retry if needed
  const validation = await validateAndRefine(plan, stepResults, vaultPath);

  // Phase 4: SYNTHESIZE — Create final structured output
  const finalText = synthesizePlanResults(plan, validation.results);

  const assistantMessage: ModelMessage = {
    role: 'assistant',
    content: finalText,
  };

  return {
    text: finalText,
    textStream: createTokenStream(finalText),
    responseMessages: Promise.resolve([assistantMessage]),
    plan,
    results: validation.results,
  };
}
