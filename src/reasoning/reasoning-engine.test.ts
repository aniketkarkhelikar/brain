/**
 * reasoning-engine.test.ts — Unit tests for the Plan-Execute-Validate reasoning layer
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createExecutionPlan } from './planner.js';
import { synthesizePlanResults, createTokenStream } from './synthesizer.js';
import type { StepExecutionResult } from './executor.js';

describe('Plan-Execute-Validate Reasoning Engine (Phase 2C)', () => {
  it('correctly classifies simple greetings without compound overhead', () => {
    const plan = createExecutionPlan('hello');
    assert.equal(plan.intent, 'chat');
    assert.equal(plan.isCompound, false);
    assert.equal(plan.steps.length, 1);
  });

  it('identifies note connection and synthesis requests', () => {
    const plan = createExecutionPlan('Find connections between my recent notes.');
    assert.equal(plan.intent, 'connections');
    assert.equal(plan.isCompound, false);
    assert.equal(plan.steps[0].kind, 'connections');

    const plan2 = createExecutionPlan('connect the dots in my vault');
    assert.equal(plan2.intent, 'connections');
  });

  it('decomposes numbered multi-task prompts into isolated steps', () => {
    const prompt = `1ST TASK GO THROUGH VAULT AND TELL ME  ABOUT MYSELF \n2ND TASK ALSO DO A SEARCH FOR CJP LATEST UPDATES AND THEN TELL ME WHATS HAPPEIN`;
    const plan = createExecutionPlan(prompt);
    assert.equal(plan.isCompound, true);
    assert.equal(plan.steps.length, 2);

    assert.equal(plan.steps[0].kind, 'vault_profile');
    assert.equal(plan.steps[1].kind, 'web_search');
    assert.match(plan.steps[1].query.toLowerCase(), /cjp/);
  });

  it('decomposes conjunction compound prompts ("X ALSO DO A SEARCH FOR Y")', () => {
    const prompt = `GO THROUGH VAULT AND TELL ME ABOUT MYSELF ALSO DO A SEARCH FOR CJP LATEST UPDATES AND THEN TELL ME WHATS HAPPEIN`;
    const plan = createExecutionPlan(prompt);
    assert.equal(plan.isCompound, true);
    assert.equal(plan.steps.length, 2);

    assert.equal(plan.steps[0].kind, 'vault_profile');
    assert.equal(plan.steps[1].kind, 'web_search');
  });

  it('synthesizes multi-task results into structured markdown sections', () => {
    const plan = createExecutionPlan('1st task: A\n2nd task: B');
    const mockResults: StepExecutionResult[] = [
      {
        step: { id: 1, title: 'About You', kind: 'vault_profile', query: 'A' },
        success: true,
        content: 'Name: Aniket, Student and engineer.',
      },
      {
        step: { id: 2, title: 'CJP Updates', kind: 'web_search', query: 'B' },
        success: true,
        content: 'Latest protest live updates in Delhi.',
      },
    ];

    const synthesized = synthesizePlanResults(plan, mockResults);
    assert.match(synthesized, /### Task 1: About You/);
    assert.match(synthesized, /Name: Aniket/);
    assert.match(synthesized, /### Task 2: CJP Updates/);
    assert.match(synthesized, /Latest protest live updates/);
  });

  it('streams tokens smoothly through createTokenStream', async () => {
    const text = 'Hello world from the Second Brain reasoning engine.';
    const tokens: string[] = [];
    for await (const token of createTokenStream(text)) {
      tokens.push(token);
    }
    assert.equal(tokens.join(''), text);
  });
});
