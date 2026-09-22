import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { ModelMessage } from 'ai';
import { compactHistory, DEFAULT_SESSION_ID, SessionStore } from './session.js';

let tempDir = '';
let dbPath = '';

describe('Phase 8 SQLite chat sessions', () => {
  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-sessions-'));
    dbPath = path.join(tempDir, 'state', 'sessions.sqlite');
  });

  beforeEach(async () => {
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a default session and persists a full turn across store restarts', () => {
    const firstStore = new SessionStore(dbPath);
    const session = firstStore.ensureSession();
    assert.equal(session.id, DEFAULT_SESSION_ID);
    firstStore.appendTurn(DEFAULT_SESSION_ID, 'Remember that the launch is Friday.', [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'vaultRead', input: { filePath: 'MEMORY.md' } }],
      } as ModelMessage,
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'vaultRead', output: { type: 'json', value: { content: 'Launch is Friday.' } } }],
      } as ModelMessage,
      { role: 'assistant', content: 'I will remember that the launch is Friday.' },
    ]);
    assert.equal(firstStore.getSession(DEFAULT_SESSION_ID)?.messageCount, 4);
    firstStore.close();

    const restartedStore = new SessionStore(dbPath);
    const messages = restartedStore.loadMessages(DEFAULT_SESSION_ID);
    assert.deepEqual(messages, [
      { role: 'user', content: 'Remember that the launch is Friday.' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'vaultRead', input: { filePath: 'MEMORY.md' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'vaultRead', output: { type: 'json', value: { content: 'Launch is Friday.' } } }],
      },
      { role: 'assistant', content: 'I will remember that the launch is Friday.' },
    ]);
    restartedStore.appendTurn(DEFAULT_SESSION_ID, 'What day?', [
      { role: 'assistant', content: 'Friday.' },
    ]);
    assert.equal(restartedStore.loadMessages(DEFAULT_SESSION_ID).length, 6);
    restartedStore.close();
  });

  it('isolates sessions and clears only the selected conversation', () => {
    const store = new SessionStore(dbPath);
    store.ensureSession(DEFAULT_SESSION_ID);
    const second = store.createSession('Project notes');
    store.appendTurn(DEFAULT_SESSION_ID, 'default message', [{ role: 'assistant', content: 'default reply' }]);
    store.appendTurn(second.id, 'project message', [{ role: 'assistant', content: 'project reply' }]);
    store.clearSession(second.id);

    assert.equal(store.loadMessages(second.id).length, 0);
    assert.equal(store.loadMessages(DEFAULT_SESSION_ID).length, 2);
    assert.deepEqual(store.listSessions().map(({ name }) => name).sort(), ['Default chat', 'Project notes']);
    store.close();
  });

  it('keeps the first two and most recent messages when compacting model context', () => {
    const messages: ModelMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    } as ModelMessage));
    const compacted = compactHistory(messages);
    assert.equal(compacted.length, 16);
    assert.equal(compacted[0].content, 'message-0');
    assert.equal(compacted[1].content, 'message-1');
    assert.equal(compacted[2].content, 'message-6');
    assert.equal(compacted.at(-1)?.content, 'message-19');
    assert.equal(compactHistory(messages.slice(0, 16)).length, 16);
    assert.throws(() => compactHistory(messages, 1), /at least 2/);
  });

  it('rejects invalid user input and refuses to load malformed persisted history', () => {
    const store = new SessionStore(dbPath);
    store.ensureSession('corrupt');
    assert.throws(() => store.appendTurn('corrupt', '  ', []), /empty user message/);
    (store as unknown as { db: { prepare: (sql: string) => { run: (...args: string[]) => void } } })
      .db.prepare('UPDATE sessions SET messages_json = ? WHERE id = ?').run('{broken', 'corrupt');
    assert.throws(() => store.loadMessages('corrupt'), /invalid JSON/);
    (store as unknown as { db: { prepare: (sql: string) => { run: (...args: string[]) => void } } })
      .db.prepare('UPDATE sessions SET messages_json = ? WHERE id = ?').run('[{"role":"operator","content":"bad"}]', 'corrupt');
    assert.throws(() => store.loadMessages('corrupt'), /invalid message format/);
    store.close();
  });
});
