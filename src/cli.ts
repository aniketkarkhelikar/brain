import type { ModelMessage } from 'ai';
import { runBootstrapIfNeeded } from './memory/bootstrap.js';
import { compactHistory, DEFAULT_SESSION_ID, SessionStore } from './memory/session.js';

export type CliIO = {
  ask: (prompt: string) => Promise<string>;
  write: (text: string) => void;
};

export type CliRuntime = CliIO & {
  vaultPath: string;
  store: SessionStore;
  initialSessionId?: string;
  respond: (prompt: string, history: ModelMessage[], onToken: (token: string) => void) => Promise<ModelMessage[]>;
};

export async function runCli(runtime: CliRuntime): Promise<void> {
  const { ask, write, store, vaultPath } = runtime;
  let sessionId = runtime.initialSessionId || DEFAULT_SESSION_ID;
  let session = store.ensureSession(sessionId, sessionId === DEFAULT_SESSION_ID ? 'Default chat' : sessionId);

  await runBootstrapIfNeeded(vaultPath, { ask, write });
  write(`\nChat session: ${session.name} (${session.id})\nType /help for commands.\n`);

  while (true) {
    let input: string;
    try {
      input = await ask('> ');
    } catch {
      write('\n');
      return;
    }
    const prompt = input.trim();
    if (!prompt) continue;

    if (prompt === '/exit' || prompt === '/quit') {
      write('Goodbye. Your conversation is saved.\n');
      return;
    }
    if (prompt === '/help') {
      write('Commands: /new [name], /use <id>, /sessions, /reset, /exit\n\n');
      continue;
    }
    if (prompt === '/sessions') {
      const sessions = store.listSessions();
      write(`${sessions.map((item) => `${item.id === sessionId ? '* ' : '  '}${item.id} — ${item.name} (${item.messageCount} messages)`).join('\n')}\n\n`);
      continue;
    }
    if (prompt === '/reset') {
      store.clearSession(sessionId);
      write('Current conversation cleared.\n\n');
      continue;
    }
    if (prompt === '/new' || prompt.startsWith('/new ')) {
      const name = prompt.slice('/new'.length).trim() || 'New chat';
      session = store.createSession(name);
      sessionId = session.id;
      write(`Started session ${session.id} — ${session.name}.\n\n`);
      continue;
    }
    if (prompt.startsWith('/use ')) {
      const requestedId = prompt.slice('/use '.length).trim();
      const requestedSession = requestedId && store.getSession(requestedId);
      if (!requestedSession) {
        write(`No session found with id "${requestedId}". Use /sessions to list sessions.\n\n`);
        continue;
      }
      session = requestedSession;
      sessionId = session.id;
      write(`Switched to ${session.name} (${session.id}).\n\n`);
      continue;
    }
    if (prompt.startsWith('/')) {
      write(`Unknown command "${prompt.split(/\s/, 1)[0]}". Type /help for commands.\n\n`);
      continue;
    }

    try {
      const history = compactHistory(store.loadMessages(sessionId));
      const responseMessages = await runtime.respond(prompt, history, (token) => write(token));
      store.appendTurn(sessionId, prompt, responseMessages);
      write('\n\n');
    } catch (error) {
      write(`\nError: ${error instanceof Error ? error.message : String(error)}\n\n`);
    }
  }
}
