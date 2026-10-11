/** Local scheduled runner for vault-only heartbeats. */

import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHeartbeat, type HeartbeatOptions } from './heartbeat-agent.js';
import { runVaultLint } from './audit.js';
import { runMemoryAudit } from './memory-audit.js';

const SCHEDULE = process.env.HEARTBEAT_CRON || '*/30 8-22 * * *';
const BRAIN_CHECK_SCHEDULE = process.env.BRAIN_CHECK_CRON || process.env.BRAIN_MEMORY_AUDIT_CRON || process.env.VAULT_LINT_CRON || '30 3 * * *';
const TIMEZONE = process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata';
let activeRun: Promise<unknown> | undefined;
let activeBrainCheckRun: Promise<unknown> | undefined;
let scheduledOperationActive = false;

export function startHeartbeatSchedule(options: HeartbeatOptions & { onStatus?: (status: string, detail?: unknown) => void; shouldRun?: () => boolean } = {}): cron.ScheduledTask {
  if (!cron.validate(SCHEDULE)) throw new Error(`Invalid HEARTBEAT_CRON expression: ${SCHEDULE}`);
  const task = cron.schedule(SCHEDULE, async () => {
    if (activeRun || scheduledOperationActive || options.shouldRun?.() === false) {
      console.log('Heartbeat skipped because the previous run is still active.');
      return;
    }
    scheduledOperationActive = true;
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
      .finally(() => { activeRun = undefined; scheduledOperationActive = false; });
    await activeRun;
  }, { timezone: options.timezone || TIMEZONE });
  console.log(`Heartbeat scheduled (${SCHEDULE}, ${options.timezone || TIMEZONE}).`);
  options.onStatus?.('scheduled');
  return task;
}

/** One scheduled brain check runs structure lint followed by the evidence-led memory audit. */
export function startBrainCheckSchedule(options: {
  vaultPath?: string;
  lintReportPath?: string;
  memoryReportPath?: string;
  timezone?: string;
  shouldRun?: () => boolean;
  onStatus?: (status: string, detail?: unknown) => void;
} = {}): cron.ScheduledTask {
  const timezone = options.timezone || TIMEZONE;
  if (!cron.validate(BRAIN_CHECK_SCHEDULE)) throw new Error(`Invalid BRAIN_CHECK_CRON expression: ${BRAIN_CHECK_SCHEDULE}`);
  const task = cron.schedule(BRAIN_CHECK_SCHEDULE, async () => {
    if (activeBrainCheckRun || scheduledOperationActive || options.shouldRun?.() === false) {
      console.log('Brain check skipped because another vault operation is active.');
      return;
    }
    scheduledOperationActive = true;
    options.onStatus?.('started');
    activeBrainCheckRun = (async () => {
      const lint = await runVaultLint(options.vaultPath, options.lintReportPath);
      const memoryAudit = await runMemoryAudit({ vaultPath: options.vaultPath, reportPath: options.memoryReportPath, force: true, autoFix: true });
      return { lint, memoryAudit };
    })()
      .then((report) => {
        console.log(`Brain check complete: ${report.lint.filesScanned} notes structurally checked; ${report.memoryAudit.claimsChecked} memory claims checked; ${report.memoryAudit.summary.autoFixed} corrected; ${report.memoryAudit.summary.needsReview} held for review.`);
        options.onStatus?.('completed', report);
      })
      .catch((error) => {
        console.error(`Brain check failed: ${error instanceof Error ? error.message : String(error)}`);
        options.onStatus?.('failed', error);
      })
      .finally(() => { activeBrainCheckRun = undefined; scheduledOperationActive = false; });
    await activeBrainCheckRun;
  }, { timezone });
  console.log(`Brain checks scheduled (${BRAIN_CHECK_SCHEDULE}, ${timezone}).`);
  options.onStatus?.('scheduled');
  return task;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === '--brain-check') {
    const lint = await runVaultLint();
    const memoryAudit = await runMemoryAudit({ force: true, autoFix: true });
    console.log(`Brain check complete: ${lint.filesScanned} notes structurally checked; ${memoryAudit.claimsChecked} memory claims checked; ${memoryAudit.summary.autoFixed} corrected; ${memoryAudit.summary.needsReview} held for review.`);
    if (lint.summary.errors || memoryAudit.errors.length) process.exitCode = 1;
    return;
  }
  if (command === '--audit') {
    const report = await runVaultLint();
    console.log(`Vault lint complete: scanned ${report.filesScanned} notes; ${report.summary.errors} errors; ${report.summary.warnings} warnings.`);
    for (const finding of report.findings) console.log(`- ${finding.severity}: ${finding.file}: ${finding.detail}`);
    if (report.summary.errors) process.exitCode = 1;
    return;
  }
  if (command === '--once' || command === '--process-inbox') {
    const result = await runHeartbeat({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
    const stats = result.ingestion;
    console.log(`Inbox processing complete: scanned ${stats.scanned}; created ${stats.created}; updated ${stats.updated}; already known ${stats.alreadyKnown}; review ${stats.needsReview}; failed ${stats.failed}.`);
    if (stats.failed) process.exitCode = 1;
    return;
  }
  if (command === '--memory-audit') {
    const report = await runMemoryAudit({ force: true, autoFix: true });
    console.log(`Memory audit complete: ${report.filesAudited}/${report.candidateFiles} candidate notes; ${report.claimsChecked} claims; ${report.summary.autoFixed} corrected; ${report.summary.needsReview} held for review.`);
    if (report.errors.length) process.exitCode = 1;
    return;
  }
  if (command && command !== '--retry-review') throw new Error(`Unknown heartbeat command: ${command}`);
  startHeartbeatSchedule({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
  startBrainCheckSchedule({ timezone: TIMEZONE });
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Heartbeat runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
