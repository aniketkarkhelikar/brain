/** Local scheduled runner for vault-only heartbeats. */

import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHeartbeat, type HeartbeatOptions } from './heartbeat-agent.js';
import { runVaultLint } from './audit.js';

const SCHEDULE = process.env.HEARTBEAT_CRON || '*/30 8-22 * * *';
const LINT_SCHEDULE = process.env.VAULT_LINT_CRON || '15 23 * * *';
const TIMEZONE = process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata';
let activeRun: Promise<unknown> | undefined;
let activeLintRun: Promise<unknown> | undefined;
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

export function startVaultLintSchedule(options: {
  vaultPath?: string;
  reportPath?: string;
  timezone?: string;
  shouldRun?: () => boolean;
  onStatus?: (status: string, detail?: unknown) => void;
} = {}): cron.ScheduledTask {
  const timezone = options.timezone || TIMEZONE;
  if (!cron.validate(LINT_SCHEDULE)) throw new Error(`Invalid VAULT_LINT_CRON expression: ${LINT_SCHEDULE}`);
  const task = cron.schedule(LINT_SCHEDULE, async () => {
    if (activeLintRun || scheduledOperationActive || options.shouldRun?.() === false) {
      console.log('Vault lint skipped because another vault operation is active.');
      return;
    }
    scheduledOperationActive = true;
    options.onStatus?.('started');
    activeLintRun = runVaultLint(options.vaultPath, options.reportPath)
      .then((report) => {
        console.log(`Vault lint complete: scanned ${report.filesScanned} notes; ${report.summary.errors} errors; ${report.summary.warnings} warnings.`);
        options.onStatus?.('completed', report);
      })
      .catch((error) => {
        console.error(`Vault lint failed: ${error instanceof Error ? error.message : String(error)}`);
        options.onStatus?.('failed', error);
      })
      .finally(() => { activeLintRun = undefined; scheduledOperationActive = false; });
    await activeLintRun;
  }, { timezone });
  console.log(`Vault lint scheduled (${LINT_SCHEDULE}, ${timezone}).`);
  options.onStatus?.('scheduled');
  return task;
}

async function main(): Promise<void> {
  if (process.argv.includes('--audit')) {
    const report = await runVaultLint();
    console.log(`Vault lint complete: scanned ${report.filesScanned} notes; ${report.summary.errors} errors; ${report.summary.warnings} warnings.`);
    for (const finding of report.findings) console.log(`- ${finding.severity}: ${finding.file}: ${finding.detail}`);
    if (report.summary.errors) process.exitCode = 1;
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
  startVaultLintSchedule({ timezone: TIMEZONE });
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Heartbeat runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
