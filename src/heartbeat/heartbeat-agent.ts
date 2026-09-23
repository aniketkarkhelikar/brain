/** One vault-only heartbeat run: compile Inbox items and record the outcome. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ingestInbox, type IngestOptions, type IngestStats } from './ingest.js';

export type HeartbeatOptions = IngestOptions & { timezone?: string };
export type HeartbeatResult = { startedAt: string; finishedAt: string; ingestion: IngestStats };
let activeHeartbeat: Promise<HeartbeatResult> | undefined;

function vaultRoot(options: HeartbeatOptions): string {
  return path.resolve(options.vaultPath || process.env.VAULT_PATH || './vault');
}

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function appendLine(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, text, { encoding: 'utf8', mode: 0o600 });
}

async function recordHeartbeat(root: string, timestamp: Date, timezone: string, stats: IngestStats): Promise<void> {
  const localDate = formatLocalDate(timestamp, timezone);
  const localTime = formatLocalTime(timestamp, timezone);
  const detailLines = stats.items
    .filter((item) => item.decision !== 'unchanged')
    .map((item) => {
      const destinations = item.targetPaths?.length ? item.targetPaths : item.targetPath ? [item.targetPath] : [];
      return `- ${item.decision}: \`${item.source}\`${destinations.length ? ` → ${destinations.map((target) => `\`${target}\``).join(', ')}` : ''}${item.message ? ` — ${item.message}` : ''}`;
    });
  const summary = [
    `## Heartbeat — ${localTime} (${timezone})`,
    '',
    `- Inbox Markdown files scanned: ${stats.scanned}`,
    `- New wiki pages: ${stats.created}`,
    `- Existing pages updated: ${stats.updated}`,
    `- Already represented: ${stats.alreadyKnown}`,
    `- Waiting for review: ${stats.needsReview}`,
    `- Failed: ${stats.failed}`,
    ...(detailLines.length ? ['', ...detailLines] : []),
    '',
  ].join('\n');
  await appendLine(path.join(root, 'daily', `${localDate}.md`), `${summary}\n`);
  await appendLine(path.join(root, 'log.md'), `- ${localTime} ${timezone}: heartbeat scanned ${stats.scanned}; created ${stats.created}; updated ${stats.updated}; already known ${stats.alreadyKnown}; review ${stats.needsReview}; failed ${stats.failed}.\n`);
}

async function performHeartbeat(options: HeartbeatOptions): Promise<HeartbeatResult> {
  const started = options.now?.() ?? new Date();
  const timezone = options.timezone || process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata';
  const root = vaultRoot(options);
  const ingestion = await ingestInbox(options);
  const finished = options.now?.() ?? new Date();
  await recordHeartbeat(root, finished, timezone, ingestion);
  return {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    ingestion,
  };
}

export function runHeartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResult> {
  if (activeHeartbeat) return activeHeartbeat;
  const pending = performHeartbeat(options).finally(() => {
    if (activeHeartbeat === pending) activeHeartbeat = undefined;
  });
  activeHeartbeat = pending;
  return pending;
}
