import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { bootstrapQuestionCount, runBootstrapIfNeeded } from './bootstrap.js';

async function makeVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-bootstrap-'));
  await fs.writeFile(path.join(root, 'BOOTSTRAP.md'), '# First run\n\n## Status: PENDING\n');
  await fs.writeFile(path.join(root, 'USER.md'), '# User profile\n\n## Basic Info\n- **Name:** (Your name)\n');
  await fs.writeFile(path.join(root, 'SOUL.md'), '# Soul\n\n### How Bold to Be\n\nOriginal rules.\n\n### Memory Management\n\nKeep memory useful.\n');
  return root;
}

describe('Phase 8 first-run onboarding', () => {
  it('resumes after interruption, saves each answer, updates proactivity, logs, and removes the trigger', async () => {
    const vault = await makeVault();
    try {
      let firstAnswers = 0;
      await assert.rejects(runBootstrapIfNeeded(vault, {
        ask: async () => {
          firstAnswers += 1;
          if (firstAnswers > 2) throw new Error('simulated terminal interruption');
          return firstAnswers === 1 ? 'Avery' : 'avery@example.test';
        },
        write: () => undefined,
      }), /simulated terminal interruption/);
      assert.equal(firstAnswers, 3);
      assert.match(await fs.readFile(path.join(vault, 'USER.md'), 'utf8'), /Avery/);
      assert.match(await fs.readFile(path.join(vault, 'BOOTSTRAP.md'), 'utf8'), /IN_PROGRESS \(2\/12\)/);

      const remainingAnswers = [
        'Researcher', 'Second Brain and a reading list', 'Concise and direct', 'Suggest improvements',
        '9 AM to 6 PM IST', 'Weekly team sync', 'Mina (manager)', '(Skipped)', '(Skipped)', 'Partner',
      ];
      let askCount = 0;
      const output: string[] = [];
      const completed = await runBootstrapIfNeeded(vault, {
        ask: async () => remainingAnswers[askCount++],
        write: (text) => output.push(text),
      });

      assert.equal(completed, true);
      assert.equal(askCount, 10);
      assert.equal(bootstrapQuestionCount, 12);
      assert.match(output.join(''), /Resuming first-run onboarding/);
      await assert.rejects(fs.access(path.join(vault, 'BOOTSTRAP.md')));
      const user = await fs.readFile(path.join(vault, 'USER.md'), 'utf8');
      assert.match(user, /avery@example\\\.test/);
      assert.match(user, /Active projects/);
      const soul = await fs.readFile(path.join(vault, 'SOUL.md'), 'utf8');
      assert.match(soul, /Selected level: \*\*Partner\*\*/);
      assert.match(soul, /### Memory Management/);
      assert.match(soul, /user's preference: Concise and direct/);
      assert.match(soul, /Suggestions preference: Suggest improvements/);
      const dailyDir = path.join(vault, 'daily');
      const dailyFiles = await fs.readdir(dailyDir);
      const log = await fs.readFile(path.join(dailyDir, dailyFiles[0]), 'utf8');
      assert.equal((log.match(/Onboarding complete/g) ?? []).length, 1);

      await fs.writeFile(path.join(vault, 'BOOTSTRAP.md'), '## Status: PENDING\n');
      let askedAgain = false;
      await runBootstrapIfNeeded(vault, {
        ask: async () => { askedAgain = true; return ''; },
        write: () => undefined,
      });
      assert.equal(askedAgain, false);
      const repeatedLog = await fs.readFile(path.join(dailyDir, dailyFiles[0]), 'utf8');
      assert.equal((repeatedLog.match(/Onboarding complete/g) ?? []).length, 1);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  it('does nothing when BOOTSTRAP.md is absent and retries invalid proactivity answers', async () => {
    const vault = await makeVault();
    try {
      await fs.rm(path.join(vault, 'BOOTSTRAP.md'));
      let asked = false;
      assert.equal(await runBootstrapIfNeeded(vault, {
        ask: async () => { asked = true; return ''; },
        write: () => undefined,
      }), false);
      assert.equal(asked, false);

      await fs.writeFile(path.join(vault, 'BOOTSTRAP.md'), '## Status: PENDING\n');
      let count = 0;
      const answers = ['n', 'e', 'role', 'projects', 'style', 'suggestions', 'hours', 'meetings', 'people', 'email', 'https://calendar.private/token', 'Google Calendar', 'Owner', 'Advisor'];
      const output: string[] = [];
      await runBootstrapIfNeeded(vault, {
        ask: async () => answers[count++],
        write: (text) => output.push(text),
      });
      assert.equal(count, 14);
      assert.match(output.join(''), /Please choose Observer, Advisor, Assistant, or Partner/);
      assert.match(output.join(''), /Please do not enter a private calendar URL here/);
      assert.doesNotMatch(await fs.readFile(path.join(vault, 'USER.md'), 'utf8'), /calendar\.private/);
      assert.match(await fs.readFile(path.join(vault, 'SOUL.md'), 'utf8'), /Selected level: \*\*Advisor\*\*/);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });
});
