import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { discoverSkills, loadSkill } from './loader.js';

describe('local skill library', () => {
  it('discovers the full workflow set restored from the companion branch', async () => {
    const skillsDir = path.resolve(process.cwd(), 'skills');
    const skills = await discoverSkills({ refresh: true, skillsDir });
    const names = skills.map((skill) => skill.name).sort();
    assert.deepEqual(names, [
      'contract-and-document-analyzer',
      'daily-briefing-and-planner',
      'deep-research-synthesizer',
      'high-stakes-decision-advisor',
      'meeting-prep-and-debrief',
      'project-breakdown-and-tracking',
      'raw-dump-organizer',
      'second-brain-audit',
      'second-brain-fix',
    ]);
    assert.ok(skills.every((skill) => skill.description.length > 20));
  });

  it('loads restored skill instructions through the same path as the agent', async () => {
    const loaded = await loadSkill('deep-research-synthesizer', undefined, {
      skillsDir: path.resolve(process.cwd(), 'skills'),
    });
    assert.equal(loaded.success, true);
    assert.match(loaded.content || '', /Multi-Angle Web Research/);
    assert.equal(loaded.name, 'deep-research-synthesizer');
  });
});
