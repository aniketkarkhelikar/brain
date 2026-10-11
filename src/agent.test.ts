import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applicableDecisionSkill, decisionFallbackText, decisionSearchPlan } from './agent.js';

describe('decision workflow routing', () => {
  it('routes major purchase tasks to the advisor skill and keeps private details out of searches', () => {
    const skills = [{
      name: 'high-stakes-decision-advisor',
      description: 'Combines personal context with sourced research for major decisions.',
      dirName: 'high-stakes-decision-advisor',
      skillPath: 'skills/high-stakes-decision-advisor/SKILL.md',
    }];
    const prompt = 'I have 65 lakh and am looking in Defence Colony; help me buy property in Delhi.';
    assert.equal(applicableDecisionSkill(prompt, skills)?.name, 'high-stakes-decision-advisor');
    const plan = decisionSearchPlan(prompt);
    assert.equal(plan?.subject, 'property');
    assert.equal(plan?.place, 'Delhi');
    assert.ok(plan?.queries.length);
    assert.doesNotMatch(plan?.queries.join(' ') || '', /65 lakh|Defence Colony/i);
  });

  it('does not start purchase research for general prompts or unsupported sensitive categories', () => {
    assert.equal(decisionSearchPlan('Tell me what I saved about my health.'), undefined);
    assert.equal(decisionSearchPlan('I am deciding whether to accept a job offer.'), undefined);
  });

  it('uses a safe checklist when public research fails and preserves relevant local evidence', () => {
    const plan = decisionSearchPlan('Help me buy property in Delhi.')!;
    const retrieval = `=== Application retrieval (vaultSearch; already executed) ===\n${JSON.stringify({ results: [
      { title: 'Memory', path: 'MEMORY.md', snippet: 'General memory.', score: 0.9 },
      { title: 'Home preferences', path: 'Personal_context/preferences.md', documentContent: 'Synthetic preferences: ₹1.8 crore ceiling, two bedrooms, near Metro.', score: 0.2 },
      { title: 'Old note', path: 'daily/old.md', snippet: 'Unrelated.', score: 0.8 },
      { title: 'Another note', path: 'Knowledgebase/topic.md', snippet: 'Unrelated.', score: 0.7 },
      { title: 'Property project', path: 'Work/projects/home.md', snippet: 'Compare two apartments.', score: 0.3 },
    ] })}`;
    const answer = decisionFallbackText(plan, retrieval, 'DuckDuckGo returned an anti-bot challenge.');
    assert.match(answer, /search provider did not return verifiable pages/i);
    assert.match(answer, /DuckDuckGo returned an anti-bot challenge/);
    assert.match(answer, /₹1\.8 crore/);
    assert.match(answer, /Personal_context\/preferences\.md/);
    assert.match(answer, /Indian citizen, an OCI cardholder, or a foreign national/);
    assert.doesNotMatch(answer, /typically\s+\d+%|stamp duty is \d+%/i);
  });

  it('uses vehicle-specific advice rather than property eligibility for a car decision', () => {
    const plan = decisionSearchPlan('I am buying a new car in India.')!;
    const answer = decisionFallbackText(plan, undefined, 'DuckDuckGo returned an anti-bot challenge.');
    assert.match(answer, /test drives/i);
    assert.match(answer, /itemized on-road quotes/i);
    assert.doesNotMatch(answer, /OCI|stamp duty|property lawyer/i);
  });
});
