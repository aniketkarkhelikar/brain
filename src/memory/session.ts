import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { ModelMessage } from 'ai';

export const DEFAULT_SESSION_ID = 'default';
export const DEFAULT_CONTEXT_LIMIT = 16;

type SessionRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  messages_json: string;
};

export type SessionInfo = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/**
 * Ensures message history conforms to language model protocol:
 * - Every assistant message with tool-calls MUST be immediately followed by matching tool-results.
 * - Dangling tool-calls (whose results were severed by compaction) have their tool-call parts stripped.
 * - Orphaned tool-results (whose calls were severed) are safely omitted.
 */
export function sanitizeModelMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const toolCalls = msg.content.filter((p: any) => p && typeof p === 'object' && p.type === 'tool-call');
        if (toolCalls.length > 0) {
          const nextMsg = messages[i + 1];
          const hasMatchingToolResults =
            nextMsg &&
            nextMsg.role === 'tool' &&
            Array.isArray(nextMsg.content) &&
            toolCalls.every((tc: any) =>
              nextMsg.content.some((tr: any) => tr && typeof tr === 'object' && tr.type === 'tool-result' && tr.toolCallId === tc.toolCallId)
            );

          if (hasMatchingToolResults) {
            result.push(msg);
            result.push(nextMsg);
            i++; // skip nextMsg since we included it
            continue;
          } else {
            // Dangling tool calls without results: preserve only text parts
            const textParts = msg.content
              .filter((p: any) => p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string' && p.text.trim())
              .map((p: any) => p.text)
              .join('\n');

            if (textParts.trim()) {
              result.push({ role: 'assistant', content: textParts });
            }
            continue;
          }
        }
      }
      result.push(msg);
    } else if (msg.role === 'tool') {
      // Orphaned tool result without preceding tool-call assistant message
      continue;
    } else {
      result.push(msg);
    }
  }

  return result;
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

  let selected: ModelMessage[];
  if (messages.length <= maxMessages) {
    selected = messages;
  } else {
    const recentCount = maxMessages - openingMessages;
    selected = [...messages.slice(0, openingMessages), ...messages.slice(-recentCount)];
  }

  return sanitizeModelMessages(selected);
}

function parseMessages(serialized: string, sessionId: string): ModelMessage[] {
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
  return messages as ModelMessage[];
}

export class SessionStore {
  private readonly db: Database.Database;
  private readonly insertSession: Database.Statement;
  private readonly selectSession: Database.Statement;
  private readonly updateMessages: Database.Statement;

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
      const current = parseMessages(row.messages_json, sessionId);
      const next: ModelMessage[] = [
        ...current,
        { role: 'user', content: userText },
        ...responseMessages,
      ];
      const serialized = JSON.stringify(next);
      parseMessages(serialized, sessionId);
      this.updateMessages.run(serialized, new Date().toISOString(), sessionId);
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
}
