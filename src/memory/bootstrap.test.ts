import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { bootstrapQuestionCount, getBootstrapStatus, runBootstrapIfNeeded, submitBootstrapAnswer } from './bootstrap.js';

async function makeVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-bootstrap-'));
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault, { recursive: true });
  await fs.writeFile(path.join(vault, 'BOOTSTRAP.md'), '# First run\n\n## Status: PENDING\n');
  await fs.writeFile(path.join(vault, 'USER.md'), '# User profile\n\n## Basic Info\n- **Name:** (Your name)\n- **Email:** (Your email)\n\n### Current Role\n- (What you do)\n\n### Key Projects\n- AI Second Brain (this project)\n\n### Communication Preferences\n- Direct and concise\n\n### Schedule Patterns\n- Active hours: 8 to 10\n\n### Team\n- (People)\n\n### Email\n- Primary: (your email)\n\n### Calendar\n- Google Calendar: configure .ics in .env\n');
  await fs.writeFile(path.join(vault, 'SOUL.md'), '# Soul\n\n### How Bold to Be\n\nOriginal rules.\n\n### Communication Style\n\nOriginal communication rules.\n\n### Memory Management\n\nKeep memory useful.\n');
  return vault;
}

describe('Phase 8 first-run onboarding', () => {
  it('exposes resumable browser questions, validates answers, and finalizes through the same journal', async () => {
    const vault = await makeVault();
    try {
      let status = await getBootstrapStatus(vault);
      assert.deepEqual(status, { required: true, complete: false, index: 0, total: 12, prompt: 'What name should I use for you?' });
      const answers = ['Riley', 'riley@example.test', 'Engineer', 'Brain app', 'Short and warm', 'Offer ideas', '9 AM–5 PM IST', 'None', 'None', 'Skip', 'Skip', 'Advisor'];
      for (const [index, answer] of answers.entries()) {
        if (index === 1) await assert.rejects(submitBootstrapAnswer(vault, 'not an email'), /valid email address/);
        if (index === 10) await assert.rejects(submitBootstrapAnswer(vault, 'https://private.example/calendar'), /private calendar URL/);
        if (index === 11) await assert.rejects(submitBootstrapAnswer(vault, 'Owner'), /Choose Observer/);
        status = await submitBootstrapAnswer(vault, answer);
        assert.equal(status.required, index < answers.length - 1);
      }
      assert.deepEqual(status, { required: false, complete: true });
      assert.match(await fs.readFile(path.join(vault, 'USER.md'), 'utf8'), /Riley/);
      assert.match(await fs.readFile(path.join(vault, 'SOUL.md'), 'utf8'), /Selected level: \*\*Advisor\*\*/);
      await assert.rejects(fs.access(path.join(vault, 'BOOTSTRAP.md')));
    } finally {
      await fs.rm(path.dirname(vault), { recursive: true, force: true });
    }
  });

  it('resumes after interruption, saves each answer, updates proactivity, logs, and removes the trigger', async () => {
    const vault = await makeVault();
    try {
      await fs.appendFile(path.join(vault, 'USER.md'), '\n### Current Role\n- stale duplicate\n\n## Proactivity\n- stale duplicate\n');
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
      assert.doesNotMatch(await fs.readFile(path.join(vault, 'USER.md'), 'utf8'), /Avery/);
      assert.match(await fs.readFile(path.join(vault, 'BOOTSTRAP.md'), 'utf8'), /IN_PROGRESS \(2\/12\)/);

      const remainingAnswers = [
        'Researcher', 'Second Brain and a reading list', 'Concise and direct', 'Suggest improvements',
        '9 AM to 6 PM IST', 'Weekly team sync', 'Mina (manager)', '(Skipped)', '(Skipped)', 'partner',
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
      assert.match(user, /- \*\*Name:\*\* Avery/);
      assert.match(user, /- \*\*Email:\*\* avery@example\.test/);
      assert.match(user, /Second Brain and a reading list/);
      assert.doesNotMatch(user, /\(Your name\)|brain-bootstrap-progress|Onboarding Answers/);
      assert.match(user, /Selected level: \*\*Partner\*\*/);
      assert.equal((user.match(/^### Current Role$/gm) ?? []).length, 1);
      assert.equal((user.match(/^## Proactivity$/gm) ?? []).length, 1);
      const soul = await fs.readFile(path.join(vault, 'SOUL.md'), 'utf8');
      assert.match(soul, /Selected level: \*\*Partner\*\*/);
      assert.match(soul, /### Memory Management/);
      assert.match(soul, /Reply style: Concise and direct/);
      assert.match(soul, /Suggestions: Suggest improvements/);
      const dailyDir = path.join(vault, 'daily');
      const dailyFiles = await fs.readdir(dailyDir);
      const log = await fs.readFile(path.join(dailyDir, dailyFiles[0]), 'utf8');
      assert.equal((log.match(/Onboarding complete/g) ?? []).length, 1);

      assert.deepEqual(await fs.readdir(path.resolve(vault, '..', 'state')), []);
    } finally {
      await fs.rm(path.dirname(vault), { recursive: true, force: true });
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
      const answers = ['n', 'e@example.test', 'role', 'projects', 'style', 'suggestions', 'hours', 'meetings', 'people', 'email', 'https://calendar.private/token', 'Google Calendar', 'Owner', 'Advisor'];
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
      await fs.rm(path.dirname(vault), { recursive: true, force: true });
    }
  });

  it('rejects malformed email input and records variable availability accurately', async () => {
    const vault = await makeVault();
    try {
      const answers = ['Jordan', 'not an email', 'jordan@example.test', 'Student', 'Brain', 'Short and direct', 'Only when asked', 'random time', 'none', 'none', 'skip', 'skip', 'Partner'];
      let askCount = 0;
      const output: string[] = [];
      await runBootstrapIfNeeded(vault, {
        ask: async () => answers[askCount++] ?? '',
        write: (text) => output.push(text),
      });
      assert.equal(askCount, 13);
      assert.match(output.join(''), /valid email address/);
      const user = await fs.readFile(path.join(vault, 'USER.md'), 'utf8');
      assert.match(user, /jordan@example\.test/);
      assert.match(user, /Varies; no fixed schedule reported/);
      assert.doesNotMatch(user, /not an email|random time/);
    } finally {
      await fs.rm(path.dirname(vault), { recursive: true, force: true });
    }
  });
});
