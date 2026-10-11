/**
 * validator.ts — Step Validation & Refinement Engine (Phase 2C)
 *
 * Verifies that each planned sub-task produced a substantive result,
 * triggering refinement if a step failed or was incompletely satisfied.
 */

import { executePlanStep, type StepExecutionResult } from './executor.js';
import type { ExecutionPlan, PlanStep } from './planner.js';

export interface ValidationOutcome {
  valid: boolean;
  results: StepExecutionResult[];
  refinementsMade: number;
}

export async function validateAndRefine(
  plan: ExecutionPlan,
  initialResults: StepExecutionResult[],
  vaultPath: string
): Promise<ValidationOutcome> {
  const finalResults: StepExecutionResult[] = [...initialResults];
  let refinementsMade = 0;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    let result = finalResults.find((r) => r.step.id === step.id);

    // If step was not executed, execute it now
    if (!result) {
      result = await executePlanStep(step, vaultPath);
      finalResults.push(result);
      refinementsMade++;
    }

    // If a web search step failed or returned no results, refine the query
    if (step.kind === 'web_search' && (!result.success || result.content.includes('No live search results were found'))) {
      const simplifiedQuery = simplifySearchQuery(step.query);
      if (simplifiedQuery !== step.query) {
        const refinedStep: PlanStep = {
          ...step,
          query: simplifiedQuery,
        };
        const refinedResult = await executePlanStep(refinedStep, vaultPath);
        if (refinedResult.success && !refinedResult.content.includes('No live search results were found')) {
          const idx = finalResults.findIndex((r) => r.step.id === step.id);
          if (idx !== -1) {
            finalResults[idx] = refinedResult;
            refinementsMade++;
          }
        }
      }
    }
  }

  const allSuccess = finalResults.every((r) => r.success && r.content.trim().length > 0);
  return {
    valid: allSuccess,
    results: finalResults,
    refinementsMade,
  };
}

function simplifySearchQuery(query: string): string {
  // Strip special characters, conversational filler, and extra words
  return query
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(?:latest|updates?|news|live|recent|search|for|whats?|happening)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
