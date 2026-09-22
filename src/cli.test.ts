import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ModelMessage } from 'ai';
import { runCli } from './cli.js';
import { SessionStore } from './memory/session.js';

let tempDir = '';
let dbPath = '';

describe('Phase 8 interactive CLI', () => {
  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-cli-'));
    dbPath = path.join(tempDir, 'state', 'sessions.sqlite');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('streams injected responses, carries turns forward, and reloads history after restart', async () => {
    const vaultPath = path.join(tempDir, 'vault-no-bootstrap');
    await fs.mkdir(vaultPath, { recursive: true });
    const firstStore = new SessionStore(dbPath);
    const firstInputs = ['first question', '/exit'];
    const firstOutput: string[] = [];
    await runCli({
      vaultPath,
      store: firstStore,
      ask: async () => firstInputs.shift() ?? '/exit',
      write: (text) => firstOutput.push(text),
      respond: async (prompt, history, onToken) => {
        assert.equal(prompt, 'first question');
        assert.deepEqual(history, []);
        onToken('first ');
        onToken('answer');
        return [{ role: 'assistant', content: 'first answer' }];
      },
    });
    assert.match(firstOutput.join(''), /first answer/);
    firstStore.close();

    const secondStore = new SessionStore(dbPath);
    const secondInputs = ['follow up', '/exit'];
    const secondOutput: string[] = [];
    let observedHistory: ModelMessage[] = [];
    await runCli({
      vaultPath,
      store: secondStore,
      ask: async () => secondInputs.shift() ?? '/exit',
      write: (text) => secondOutput.push(text),
      respond: async (_prompt, history, onToken) => {
        observedHistory = history;
        onToken('Friday');
        return [{ role: 'assistant', content: 'Friday' }];
      },
    });
    assert.deepEqual(observedHistory, [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
    ]);
    assert.match(secondOutput.join(''), /Goodbye\. Your conversation is saved\./);
    assert.equal(secondStore.loadMessages('default').length, 4);
    secondStore.close();
  });

  it('starts and resumes named sessions and clears only the active session', async () => {
    const vaultPath = path.join(tempDir, 'vault-commands');
    await fs.mkdir(vaultPath, { recursive: true });
    const store = new SessionStore(dbPath);
    store.ensureSession('default');
    const inputs = ['/new Project chat', 'project question', '/sessions', '/use default', '/reset', '/exit'];
    let responseSession = '';
    const output: string[] = [];
    await runCli({
      vaultPath,
      store,
      ask: async () => inputs.shift() ?? '/exit',
      write: (text) => output.push(text),
      respond: async (_prompt, _history, _onToken) => {
        responseSession = store.listSessions().find(({ name }) => name === 'Project chat')?.id ?? '';
        return [{ role: 'assistant', content: 'project response' }];
      },
    });
    assert.ok(responseSession);
    assert.equal(store.loadMessages(responseSession).length, 2);
    assert.equal(store.loadMessages('default').length, 0);
    assert.match(output.join(''), /Project chat/);
    store.close();
  });

  it('runs the onboarding interview before accepting chat messages', async () => {
    const vaultPath = path.join(tempDir, 'vault-bootstrap-cli');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.writeFile(path.join(vaultPath, 'BOOTSTRAP.md'), '## Status: PENDING\n');
    await fs.writeFile(path.join(vaultPath, 'USER.md'), '# User\n');
    await fs.writeFile(path.join(vaultPath, 'SOUL.md'), '# Soul\n');
    const store = new SessionStore(dbPath);
    const answers = ['Avery', 'avery@example.test', 'Developer', 'Brain', 'Direct', 'Suggest', '9 to 5', 'None', 'Mina', '', '', 'Observer', '/exit'];
    const output: string[] = [];
    let modelCalled = false;
    await runCli({
      vaultPath,
      store,
      ask: async () => answers.shift() ?? '/exit',
      write: (text) => output.push(text),
      respond: async () => { modelCalled = true; return []; },
    });
    assert.equal(modelCalled, false);
    assert.match(output.join(''), /First-run onboarding/);
    assert.match(output.join(''), /Chat session:/);
    await assert.rejects(fs.access(path.join(vaultPath, 'BOOTSTRAP.md')));
    store.close();
  });
});
