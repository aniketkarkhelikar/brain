/** Local scheduled runner for vault-only heartbeats. */

import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { runHeartbeat, type HeartbeatOptions } from './heartbeat-agent.js';
import { runSecondBrainAudit } from './audit.js';

const SCHEDULE = process.env.HEARTBEAT_CRON || '*/30 8-22 * * *';
const AUDIT_SCHEDULE = process.env.AUDIT_CRON || '30 21 * * 0';
const TIMEZONE = process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata';
let activeRun: Promise<unknown> | undefined;
let activeAuditRun: Promise<unknown> | undefined;

export function startHeartbeatSchedule(options: HeartbeatOptions & { onStatus?: (status: string, detail?: unknown) => void } = {}): cron.ScheduledTask {
  if (!cron.validate(SCHEDULE)) throw new Error(`Invalid HEARTBEAT_CRON expression: ${SCHEDULE}`);
  const task = cron.schedule(SCHEDULE, async () => {
    if (activeRun) {
      console.log('Heartbeat skipped because the previous run is still active.');
      return;
    }
    options.onStatus?.('started');
    activeRun = runHeartbeat({ ...options, timezone: options.timezone || TIMEZONE })
      .then((result) => {
        const stats = result.ingestion;
        console.log(`Heartbeat complete: ${stats.created} created, ${stats.updated} updated, ${stats.needsReview} need review, ${stats.failed} failed.`);
        options.onStatus?.('completed', stats);
      })
      .catch((error) => {
        console.error(`Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
        options.onStatus?.('failed', error);
      })
      .finally(() => { activeRun = undefined; });
    await activeRun;
  }, { timezone: options.timezone || TIMEZONE });
  console.log(`Heartbeat scheduled (${SCHEDULE}, ${options.timezone || TIMEZONE}).`);
  options.onStatus?.('scheduled');
  return task;
}

export function startAuditSchedule(options: { vaultPath?: string; timezone?: string } = {}): cron.ScheduledTask {
  if (!cron.validate(AUDIT_SCHEDULE)) throw new Error(`Invalid AUDIT_CRON expression: ${AUDIT_SCHEDULE}`);
  const task = cron.schedule(AUDIT_SCHEDULE, async () => {
    if (activeAuditRun) {
      console.log('Weekly audit skipped because a previous audit run is active.');
      return;
    }
    activeAuditRun = runSecondBrainAudit(options.vaultPath)
      .then((report) => {
        console.log(`Weekly Second Brain Audit complete: scanned ${report.filesScanned} notes; ${report.summary.totalClaims} claims (${report.summary.contradicted} contradicted); ${report.summary.brokenLinks} broken links; ${report.summary.orphans} orphans.`);
      })
      .catch((error) => {
        console.error(`Weekly Second Brain Audit failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => { activeAuditRun = undefined; });
    await activeAuditRun;
  }, { timezone: options.timezone || TIMEZONE });
  console.log(`Weekly Second Brain Audit scheduled (${AUDIT_SCHEDULE}, ${options.timezone || TIMEZONE}).`);
  return task;
}

async function main(): Promise<void> {
  if (process.argv.includes('--audit')) {
    console.log('Running one-shot Second Brain Audit...');
    const report = await runSecondBrainAudit();
    console.log(`Audit complete: scanned ${report.filesScanned} notes; ${report.summary.totalClaims} claims (${report.summary.confirmed} confirmed, ${report.summary.contradicted} contradicted, ${report.summary.unsupported} unsupported); ${report.summary.brokenLinks} broken links; ${report.summary.orphans} orphans.`);
    return;
  }
  if (process.argv.includes('--once')) {
    const result = await runHeartbeat({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
    const stats = result.ingestion;
    console.log(`Heartbeat complete: scanned ${stats.scanned}; created ${stats.created}; updated ${stats.updated}; already known ${stats.alreadyKnown}; review ${stats.needsReview}; failed ${stats.failed}.`);
    if (stats.failed) process.exitCode = 1;
    return;
  }
  startHeartbeatSchedule({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
  startAuditSchedule({ timezone: TIMEZONE });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Heartbeat runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
