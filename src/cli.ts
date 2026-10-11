import type { ModelMessage } from 'ai';
import { runBootstrapIfNeeded } from './memory/bootstrap.js';
import { compactHistory, DEFAULT_SESSION_ID, SessionStore } from './memory/session.js';
import { ingestInbox, listInboxReviewQueue } from './heartbeat/ingest.js';
import { runSecondBrainAudit } from './heartbeat/audit.js';

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
      write('Commands: /new [name], /use <id>, /sessions, /review, /audit, /reset, /exit\n\n');
      continue;
    }
    if (prompt === '/review') {
      try {
        const queue = await listInboxReviewQueue(vaultPath);
        if (!queue.length) {
          write('Inbox review queue is empty.\n\n');
          continue;
        }
        write(`Inbox review queue (${queue.length}):\n${queue.map((item, index) => `${index + 1}. ${item.source} [${item.status}] — ${item.message}`).join('\n')}\n`);
        const selection = (await ask('Choose a note number to resolve, or 0 to cancel.\n> ')).trim();
        const index = Number(selection) - 1;
        if (selection === '0') {
          write('Review cancelled.\n\n');
          continue;
        }
        if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
          write('Invalid selection. Run /review to see the queue again.\n\n');
          continue;
        }
        const selected = queue[index];
        const guidance = (await ask(`How should I resolve ${selected.source}? Give an exact destination path or a short correction; say "cancel" to leave it parked.\n> `)).trim();
        if (!guidance || /^(?:cancel|skip)$/i.test(guidance)) {
          write('Note left in the review queue.\n\n');
          continue;
        }
        const result = await ingestInbox({
          vaultPath,
          retryNeedsReview: true,
          sourcePaths: [selected.source],
          reviewGuidance: { [selected.source]: guidance },
        });
        const item = result.items[0];
        if (!item) write('No result was returned for the selected note.\n\n');
        else write(`${item.decision}: ${item.source}${item.targetPaths?.length ? ` → ${item.targetPaths.join(', ')}` : item.targetPath ? ` → ${item.targetPath}` : ''}${item.message ? ` (${item.message})` : ''}\n\n`);
      } catch (error) {
        write(`Review failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
      }
      continue;
    }
    if (prompt === '/audit') {
      try {
        write('Running Second Brain Audit (Cole Medin architecture)...\n');
        const report = await runSecondBrainAudit(vaultPath);
        write(`\nAudit Report (${report.auditedAt}):\n`);
        write(`- Notes Scanned: ${report.filesScanned}\n`);
        write(`- State Claims: ${report.summary.totalClaims} (${report.summary.confirmed} confirmed, ${report.summary.contradicted} contradicted, ${report.summary.unsupported} unsupported)\n`);
        write(`- Broken Wikilinks: ${report.summary.brokenLinks}\n`);
        write(`- Orphan Notes: ${report.summary.orphans}\n`);
        if (report.summary.contradicted > 0) {
          write('\nContradicted Claims (Context Rot):\n');
          for (const claim of report.claims.filter((c) => c.status === 'contradicted')) {
            write(`  - [${claim.sourceFile}] "${claim.claim}" → ${claim.evidence ?? 'Contradicted by newer notes'}\n`);
          }
        }
        if (report.brokenLinks.length > 0) {
          write('\nBroken Links:\n');
          for (const link of report.brokenLinks) {
            write(`  - [${link.sourceFile}] → [[${link.target}]]\n`);
          }
        }
        if (report.orphanNotes.length > 0) {
          write(`\nOrphan Notes (${report.orphanNotes.length}):\n`);
          for (const orphan of report.orphanNotes.slice(0, 5)) {
            write(`  - ${orphan}\n`);
          }
        }
        write('\nAudit summary recorded to log.md and daily notes.\n\n');
      } catch (error) {
        write(`Audit failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
      }
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
