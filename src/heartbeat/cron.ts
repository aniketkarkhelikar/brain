/** Local scheduled runner for vault-only heartbeats. */

import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { runHeartbeat, type HeartbeatOptions } from './heartbeat-agent.js';

const SCHEDULE = process.env.HEARTBEAT_CRON || '*/30 8-22 * * *';
const TIMEZONE = process.env.HEARTBEAT_TIMEZONE || 'Asia/Kolkata';
let activeRun: Promise<unknown> | undefined;

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

async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    const result = await runHeartbeat({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
    const stats = result.ingestion;
    console.log(`Heartbeat complete: scanned ${stats.scanned}; created ${stats.created}; updated ${stats.updated}; already known ${stats.alreadyKnown}; review ${stats.needsReview}; failed ${stats.failed}.`);
    if (stats.failed) process.exitCode = 1;
    return;
  }
  startHeartbeatSchedule({ retryNeedsReview: process.argv.includes('--retry-review'), timezone: TIMEZONE });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Heartbeat runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
