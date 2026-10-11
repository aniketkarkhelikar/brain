import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSkills, formatSkillsPrompt, loadSkill } from './loader.js';
import { skillLoad } from '../tools/skill-load.js';

test('Anthropic Agent Skills standard runtime', async (t) => {
  await t.test('discovers all installed general skills', async () => {
    const skills = await discoverSkills({ refresh: true });
    assert.ok(skills.length >= 8, `Expected at least 8 skills, found ${skills.length}`);

    const expectedSkills = [
      'contract-and-document-analyzer',
      'daily-briefing-and-planner',
      'deep-research-synthesizer',
      'high-stakes-decision-advisor',
      'meeting-prep-and-debrief',
      'project-breakdown-and-tracking',
      'raw-dump-organizer',
      'second-brain-audit',
    ];

    for (const exp of expectedSkills) {
      const match = skills.find((s) => s.name === exp);
      assert.ok(match, `Expected skill "${exp}" was not discovered`);
      assert.ok(match.description.length > 20, `Skill "${exp}" has too short description`);
      assert.ok(match.skillPath.endsWith('SKILL.md'), `Skill path must end with SKILL.md`);
    }
  });

  await t.test('formats Level 1 metadata into prompt block', async () => {
    const skills = await discoverSkills();
    const promptBlock = formatSkillsPrompt(skills);

    assert.ok(promptBlock.includes('<available_skills>'));
    assert.ok(promptBlock.includes('</available_skills>'));
    assert.ok(promptBlock.includes('high-stakes-decision-advisor'));
    assert.ok(promptBlock.includes('deep-research-synthesizer'));
    assert.ok(promptBlock.includes('skillLoad'));
  });

  await t.test('loads Level 2 instructions dynamically for a skill', async () => {
    const res = await loadSkill('high-stakes-decision-advisor');
    assert.equal(res.success, true);
    assert.equal(res.name, 'high-stakes-decision-advisor');
    assert.ok(res.content, 'Content must be present');
    assert.ok(res.content.includes('High-Stakes Decision Advisor Skill'));
    assert.ok(res.content.includes('Mine Personal Context'));
    assert.ok(res.content.includes('Dynamically generate all checklists'));
    assert.ok(res.content.includes('Work/decisions/'));
  });

  await t.test('returns clear error for non-existent skill', async () => {
    const res = await loadSkill('non-existent-skill');
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('not found'));
    assert.ok(res.error?.includes('Available skills'));
  });

  await t.test('blocks directory traversal attempts in loadSkill', async () => {
    const res = await loadSkill('high-stakes-decision-advisor', '../../etc/passwd');
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('traverses outside'));
  });

  await t.test('executes skillLoad tool interface properly', async () => {
    const output = await (skillLoad as any).execute({
      skillName: 'second-brain-audit',
    });
    assert.equal(output.success, true);
    assert.equal(output.name, 'second-brain-audit');
    assert.ok(output.content.includes('State vs. Event'));
  });
});
