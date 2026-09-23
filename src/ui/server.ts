import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { ModelMessage } from 'ai';
import { agentStream } from '../agent.js';
import { runHeartbeat } from '../heartbeat/heartbeat-agent.js';
import { startHeartbeatSchedule } from '../heartbeat/cron.js';
import { ingestInbox, listInboxReviewQueue } from '../heartbeat/ingest.js';
import { compactHistory, DEFAULT_SESSION_ID, SessionStore } from '../memory/session.js';
import { getBootstrapStatus, submitBootstrapAnswer } from '../memory/bootstrap.js';
import { searchVault } from '../memory/search.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '../../ui');
const vaultRoot = path.resolve(process.env.VAULT_PATH || './vault');
const host = process.env.UI_HOST || '127.0.0.1';
const port = Number(process.env.UI_PORT || 4173);
const store = new SessionStore();
store.ensureSession(DEFAULT_SESSION_ID, 'Assistant');
const events = new EventEmitter();
let lastActivity: Record<string, unknown> | undefined;
let busy = false;

function publish(type: string, detail: Record<string, unknown> = {}) {
  lastActivity = { type, at: new Date().toISOString(), ...detail };
  events.emit('activity', lastActivity);
}
function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request body too large.'); }
  return raw ? JSON.parse(raw) : {};
}
function safeVaultPath(input: unknown): string {
  if (typeof input !== 'string' || !input || path.isAbsolute(input)) throw new Error('A vault-relative file path is required.');
  const resolved = path.resolve(vaultRoot, input);
  const rel = path.relative(vaultRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path is outside the vault.');
  return resolved;
}
async function verifiedVaultPath(input: unknown): Promise<string> {
  const resolved = safeVaultPath(input);
  const real = await fs.realpath(resolved);
  const rel = path.relative(await fs.realpath(vaultRoot), real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path resolves outside the vault.');
  return real;
}
async function listFiles(dir = ''): Promise<Array<{ path: string; name: string; folder: string; modified: string; bytes: number }>> {
  const start = dir ? await verifiedVaultPath(dir) : await fs.realpath(vaultRoot);
  const rows: Array<{ path: string; name: string; folder: string; modified: string; bytes: number }> = [];
  async function walk(folder: string) {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'Archive') continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = await fs.stat(absolute);
        const relative = path.relative(vaultRoot, absolute).split(path.sep).join('/');
        rows.push({ path: relative, name: entry.name.replace(/\.md$/i, ''), folder: path.dirname(relative) === '.' ? 'Root' : path.dirname(relative), modified: stat.mtime.toISOString(), bytes: stat.size });
      }
    }
  }
  await walk(start);
  return rows.sort((a, b) => b.modified.localeCompare(a.modified));
}
function flattenMessages(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : message.content.map((part: any) => part.text ?? (part.type?.includes('tool') ? `Used ${part.toolName || 'a vault tool'}` : '')).filter(Boolean).join('\n'),
  })).filter((message) => message.role === 'user' || message.role === 'assistant').filter((message) => message.content.trim());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  try {
    if (req.headers.host && host === '127.0.0.1' && ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 421, { error: 'Use the local UI address.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin actions are not allowed.' }); }
      catch { return json(res, 403, { error: 'Invalid request origin.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: ready\ndata: ${JSON.stringify({ busy, lastActivity })}\n\n`);
      const listener = (event: unknown) => res.write(`event: activity\ndata: ${JSON.stringify(event)}\n\n`);
      events.on('activity', listener);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { events.off('activity', listener); clearInterval(ping); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/overview') {
      const queue = await listInboxReviewQueue(vaultRoot);
      const files = await listFiles();
      let recentRuns: string[] = [];
      try { recentRuns = (await fs.readFile(path.join(vaultRoot, 'log.md'), 'utf8')).split(/\r?\n/).filter(Boolean).slice(-8).reverse(); } catch { /* an empty operations log is normal */ }
      return json(res, 200, { model: process.env.ACTIVE_MODEL || 'ollama:qwen2.5:14b', vault: path.basename(vaultRoot), vaultPath: vaultRoot, fileCount: files.length, reviewCount: queue.length, review: queue.slice(0, 5), recentRuns, sessions: store.listSessions().slice(0, 12), lastActivity, busy, schedule: process.env.HEARTBEAT_CRON || '*/30 8-22 * * *', timezone: process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata' });
    }
    if (req.method === 'GET' && url.pathname === '/api/onboarding') return json(res, 200, await getBootstrapStatus(vaultRoot));
    if (req.method === 'POST' && url.pathname === '/api/onboarding') {
      const data = await body(req); if (typeof data.answer !== 'string' || data.answer.length > 2_000) return json(res, 400, { error: 'Answer must be under 2,000 characters.' });
      try { const status = await submitBootstrapAnswer(vaultRoot, data.answer); publish('onboarding', { message: status.required ? `Setup · ${status.index + 1} of ${status.total}` : 'First-run setup complete.' }); return json(res, 200, status); }
      catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, 200, store.listSessions());
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const data = await body(req); const session = store.createSession(String(data.name || 'New conversation').slice(0, 80)); return json(res, 201, session);
    }
    const sessionMessages = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && sessionMessages) {
      const id = decodeURIComponent(sessionMessages[1]); if (!store.getSession(id)) return json(res, 404, { error: 'Session not found.' });
      return json(res, 200, flattenMessages(store.loadMessages(id)));
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const data = await body(req); const prompt = String(data.prompt || '').trim(); const id = String(data.sessionId || DEFAULT_SESSION_ID);
      if ((await getBootstrapStatus(vaultRoot)).required) return json(res, 409, { error: 'Complete first-run setup before chatting.' });
      if (!prompt || prompt.length > 20_000) return json(res, 400, { error: 'Enter a message under 20,000 characters.' });
      if (!store.getSession(id)) return json(res, 404, { error: 'Session not found.' });
      if (busy) return json(res, 409, { error: 'The assistant is already responding. Try again in a moment.' });
      busy = true; publish('thinking', { message: 'Searching your brain and preparing a response.' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type: string, payload: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      try {
        const history = compactHistory(store.loadMessages(id));
        const result = await agentStream(prompt, history, { onToolActivity: (name, input) => send('tool', { name, input }) });
        for await (const token of result.textStream) send('delta', { text: token });
        const responseMessages = await result.responseMessages as ModelMessage[];
        store.appendTurn(id, prompt, responseMessages);
        send('done', { messages: flattenMessages([{ role: 'user', content: prompt }, ...responseMessages]) });
        publish('assistant', { message: 'Your assistant finished a response.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send('error', { error: message }); publish('error', { message });
      } finally { busy = false; res.end(); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/brain/files') return json(res, 200, await listFiles(url.searchParams.get('folder') || ''));
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      const tasks: Array<{ text: string; path: string; line: number; completed: boolean }> = [];
      for (const file of await listFiles()) {
        if (['HEARTBEAT.MD', 'BOOTSTRAP.MD', 'SOUL.MD'].includes(path.basename(file.path).toUpperCase())) continue;
        const content = await fs.readFile(await verifiedVaultPath(file.path), 'utf8');
        content.split(/\r?\n/).forEach((line, index) => {
          const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
          if (match) tasks.push({ text: match[2], path: file.path, line: index + 1, completed: match[1].toLowerCase() === 'x' });
        });
      }
      return json(res, 200, tasks);
    }
    if (req.method === 'GET' && url.pathname === '/api/brain/search') {
      const query = url.searchParams.get('q')?.trim(); if (!query) return json(res, 200, { results: [] });
      return json(res, 200, await searchVault(query, 20));
    }
    const note = url.pathname === '/api/brain/note' && url.searchParams.get('path');
    if (req.method === 'GET' && note) return json(res, 200, { path: note, content: await fs.readFile(await verifiedVaultPath(note), 'utf8') });
    if (req.method === 'GET' && url.pathname === '/api/review') return json(res, 200, await listInboxReviewQueue(vaultRoot));
    if (req.method === 'POST' && url.pathname === '/api/review/retry') {
      const data = await body(req); const source = String(data.source || ''); const guidance = String(data.guidance || '').trim();
      if (!source.startsWith('Inbox/') || !guidance || guidance.length > 2_000) return json(res, 400, { error: 'Provide a queued Inbox path and concise guidance.' });
      if (busy) return json(res, 409, { error: 'A vault operation is already running.' });
      busy = true; publish('ingest-start', { message: `Resolving ${source}.` });
      try { const result = await ingestInbox({ vaultPath: vaultRoot, retryNeedsReview: true, sourcePaths: [source], reviewGuidance: { [source]: guidance } }); publish('ingest-done', { message: `Review complete · ${result.created} created · ${result.updated} updated · ${result.needsReview} still need review`, stats: result }); return json(res, 200, result); }
      finally { busy = false; }
    }
    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      if (busy) return json(res, 409, { error: 'A vault operation is already running.' });
      busy = true; publish('ingest-start', { message: 'Inbox ingestion started.' });
      try { const stats = await ingestInbox({ vaultPath: vaultRoot }); publish('ingest-done', { message: `Ingestion complete · ${stats.created} created · ${stats.updated} updated · ${stats.needsReview} to review`, stats }); return json(res, 200, stats); }
      catch (error) { publish('error', { message: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { busy = false; }
    }
    if (req.method === 'POST' && url.pathname === '/api/heartbeat') {
      if (busy) return json(res, 409, { error: 'A vault operation is already running.' });
      busy = true; publish('heartbeat-start', { message: 'Scheduled brain check started.' });
      try { const result = await runHeartbeat({ vaultPath: vaultRoot, timezone: process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata' }); publish('heartbeat-done', { message: 'Brain check complete.', stats: result.ingestion }); return json(res, 200, result); }
      catch (error) { publish('error', { message: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { busy = false; }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) return json(res, 404, { error: 'No such API route.' });
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(publicRoot, requested);
    const relative = path.relative(publicRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return json(res, 404, { error: 'Not found.' });
    const content = await fs.readFile(file);
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); res.end(content);
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) }); else res.end();
  }
});

server.listen(port, host, () => {
  console.log(`Second Brain UI ready at http://${host}:${port} · vault ${vaultRoot}`);
  startHeartbeatSchedule({ vaultPath: vaultRoot, onStatus: (status, detail) => {
    if (status === 'started') { busy = true; publish('heartbeat-start', { message: 'Scheduled brain check started.' }); }
    else if (status === 'completed') { busy = false; publish('heartbeat-done', { message: 'Scheduled brain check complete.', stats: (detail as any)?.items ? detail : undefined }); }
    else if (status === 'failed') { busy = false; publish('error', { message: detail instanceof Error ? detail.message : String(detail) }); }
    else if (status === 'scheduled') publish('schedule-ready', { message: 'Automatic brain checks are scheduled.' });
  } });
});
server.on('close', () => { store.close(); });
