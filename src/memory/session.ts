import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { ModelMessage } from 'ai';
import { normalizeChatSources, normalizeToolTrace, type ChatSource, type ToolTraceStep } from '../types/chat.js';

export const DEFAULT_SESSION_ID = 'default';
export const DEFAULT_CONTEXT_LIMIT = 16;

type SessionRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  messages_json: string;
};

export type StoredModelMessage = ModelMessage & { sources?: ChatSource[]; toolTrace?: ToolTraceStep[] };

export type SessionInfo = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/** Keep only conversational text; tool calls/results are execution details, not chat history. */
export function normalizeConversationMessages(messages: ModelMessage[]): ModelMessage[] {
  const normalized: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((part: any) => part.type === 'text' ? [part.text] : []).join('');
    if (!content.trim()) continue;
    normalized.push({ role: message.role, content });
  }
  return normalized;
}

/** Keep the opening context and the most recent messages sent back to the model. */
export function compactHistory(
  messages: ModelMessage[],
  maxMessages = DEFAULT_CONTEXT_LIMIT,
  openingMessages = 2,
): ModelMessage[] {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 2) {
    throw new Error('maxMessages must be an integer of at least 2.');
  }
  if (!Number.isSafeInteger(openingMessages) || openingMessages < 0 || openingMessages >= maxMessages) {
    throw new Error('openingMessages must be a non-negative integer smaller than maxMessages.');
  }
  const conversation = normalizeConversationMessages(messages);
  if (conversation.length <= maxMessages) return conversation;

  const recentCount = maxMessages - openingMessages;
  let recentStart = Math.max(openingMessages, conversation.length - recentCount);
  if (conversation[recentStart]?.role !== 'user') recentStart -= 1;
  return [...conversation.slice(0, openingMessages), ...conversation.slice(recentStart)];
}

function parseMessages(serialized: string, sessionId: string): StoredModelMessage[] {
  let messages: unknown;
  try {
    messages = JSON.parse(serialized);
  } catch {
    throw new Error(`Saved chat history for session "${sessionId}" is invalid JSON.`);
  }
  const validRoles = new Set(['system', 'user', 'assistant', 'tool']);
  if (!Array.isArray(messages) || messages.some((message) =>
    !message || typeof message !== 'object' ||
    !('role' in message) || !validRoles.has(String(message.role)) ||
    !('content' in message) || !(typeof message.content === 'string' || Array.isArray(message.content))
  )) {
    throw new Error(`Saved chat history for session "${sessionId}" has an invalid message format.`);
  }
  return messages as StoredModelMessage[];
}

export class SessionStore {
  private readonly db: Database.Database;
  private readonly insertSession: Database.Statement;
  private readonly selectSession: Database.Statement;
  private readonly updateMessages: Database.Statement;
  private readonly updateSessionName: Database.Statement;

  constructor(dbPath = process.env.BRAIN_SESSION_DB || './state/sessions.sqlite') {
    const resolvedDbPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true, mode: 0o700 });
    this.db = new Database(resolvedDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]'
      )
    `);
    try {
      fs.chmodSync(resolvedDbPath, 0o600);
    } catch {
      // File permission hardening is best effort on filesystems without chmod support.
    }

    this.insertSession = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at, messages_json)
      VALUES (?, ?, ?, ?, '[]')
    `);
    this.selectSession = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.updateMessages = this.db.prepare('UPDATE sessions SET messages_json = ?, updated_at = ? WHERE id = ?');
    this.updateSessionName = this.db.prepare('UPDATE sessions SET name = ? WHERE id = ? AND name IN (\'New chat\', \'New conversation\')');
  }

  ensureSession(id = DEFAULT_SESSION_ID, name = 'Default chat'): SessionInfo {
    const now = new Date().toISOString();
    this.insertSession.run(id, name, now, now);
    const row = this.selectSession.get(id) as SessionRow | undefined;
    if (!row) throw new Error(`Could not create session "${id}".`);
    return this.toInfo(row);
  }

  createSession(name = 'New chat'): SessionInfo {
    return this.ensureSession(randomUUID(), name.trim() || 'New chat');
  }

  getSession(id: string): SessionInfo | undefined {
    const row = this.selectSession.get(id) as SessionRow | undefined;
    return row ? this.toInfo(row) : undefined;
  }

  listSessions(): SessionInfo[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[];
    return rows.map((row) => this.toInfo(row));
  }

  loadMessages(sessionId: string): ModelMessage[] {
    const row = this.selectSession.get(sessionId) as SessionRow | undefined;
    if (!row) throw new Error(`Session "${sessionId}" does not exist.`);
    return parseMessages(row.messages_json, sessionId);
  }

  appendTurn(sessionId: string, userText: string, responseMessages: ModelMessage[]): void {
    if (!userText.trim()) throw new Error('Cannot save an empty user message.');
    if (!Array.isArray(responseMessages)) throw new Error('Response history must be an array of messages.');

    const append = this.db.transaction(() => {
      const row = this.selectSession.get(sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session "${sessionId}" does not exist.`);
      const current = parseMessages(row.messages_json, sessionId)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ ...message }));
      const next: StoredModelMessage[] = [
        ...current,
        { role: 'user', content: userText },
        ...normalizeConversationMessages(responseMessages).filter((message) => message.role === 'assistant'),
      ];
      this.nameConversation(sessionId, row.name, userText);
      const serialized = JSON.stringify(next);
      parseMessages(serialized, sessionId);
      this.updateMessages.run(serialized, new Date().toISOString(), sessionId);
    });
    append();
  }

  /** Save a submitted prompt before generation so a refresh or model error cannot erase it. */
  appendUserMessage(sessionId: string, userText: string): void {
    if (!userText.trim()) throw new Error('Cannot save an empty user message.');
    const append = this.db.transaction(() => {
      const row = this.selectSession.get(sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session "${sessionId}" does not exist.`);
      const current = parseMessages(row.messages_json, sessionId)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ ...message }));
      current.push({ role: 'user', content: userText });
      this.nameConversation(sessionId, row.name, userText);
      this.updateMessages.run(JSON.stringify(current), new Date().toISOString(), sessionId);
    });
    append();
  }

  /** Save the assistant response and source trail for review after the turn completes. */
  appendAssistantMessage(sessionId: string, responseMessages: ModelMessage[], sources: ChatSource[] = [], toolTrace: ToolTraceStep[] = []): void {
    const assistantMessages = normalizeConversationMessages(responseMessages)
      .filter((message) => message.role === 'assistant') as StoredModelMessage[];
    if (!assistantMessages.length) return;
    const normalizedSources = normalizeChatSources(sources);
    assistantMessages[assistantMessages.length - 1] = {
      ...assistantMessages[assistantMessages.length - 1],
      ...(normalizedSources.length ? { sources: normalizedSources } : {}),
      ...(normalizeToolTrace(toolTrace).length ? { toolTrace: normalizeToolTrace(toolTrace) } : {}),
    };
    const append = this.db.transaction(() => {
      const row = this.selectSession.get(sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session "${sessionId}" does not exist.`);
      const current = parseMessages(row.messages_json, sessionId)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ ...message }));
      const next = [...current, ...assistantMessages];
      this.updateMessages.run(JSON.stringify(next), new Date().toISOString(), sessionId);
    });
    append();
  }

  clearSession(sessionId: string): void {
    const result = this.db.prepare('UPDATE sessions SET messages_json = \'[]\', updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), sessionId);
    if (result.changes === 0) throw new Error(`Session "${sessionId}" does not exist.`);
  }

  close(): void {
    this.db.close();
  }

  private toInfo(row: SessionRow): SessionInfo {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: parseMessages(row.messages_json, row.id).length,
    };
  }

  private nameConversation(sessionId: string, currentName: string, firstPrompt: string): void {
    if (!['New chat', 'New conversation'].includes(currentName)) return;
    const title = firstPrompt.replace(/\s+/g, ' ').trim().slice(0, 52);
    if (title) this.updateSessionName.run(title, sessionId);
  }
}
