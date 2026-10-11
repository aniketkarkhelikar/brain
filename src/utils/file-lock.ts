/**
 * file-lock.ts — Safe cross-process and in-process file locking for the AI Brain vault.
 * Prevents race conditions and corruption when heartbeat, ingestion, CLI, or UI write concurrently.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export type LockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  pollIntervalMs?: number;
};

type LockPayload = {
  pid: number;
  createdAt: number;
  target: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === 'EPERM'; // Alive if permission denied
  }
}

export function lockFilePath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return `${resolved}.lock`;
}

/**
 * Attempts to acquire an atomic lock for a given file path.
 * Retries until timeout or stale lock is detected and broken.
 */
export async function acquireLock(targetPath: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const lockPath = lockFilePath(targetPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  while (Date.now() < deadline) {
    const payload: LockPayload = {
      pid: process.pid,
      createdAt: Date.now(),
      target: path.resolve(targetPath),
    };

    try {
      await fs.writeFile(lockPath, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = await fs.readFile(lockPath, 'utf8');
          const parsed = JSON.parse(current) as LockPayload;
          if (parsed.pid === process.pid) {
            await fs.rm(lockPath, { force: true });
          }
        } catch {
          // If already removed or unreadable, ignore
        }
      };
    } catch (error) {
      if (!isEexist(error)) throw error;

      // Check if existing lock is stale
      try {
        const raw = await fs.readFile(lockPath, 'utf8');
        const existing = JSON.parse(raw) as LockPayload;
        const isStale = (Date.now() - existing.createdAt) > staleMs;
        const deadProcess = !isProcessAlive(existing.pid);

        if (isStale || deadProcess) {
          // Break stale lock safely
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (readError) {
        if (isEnoent(readError)) continue;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(`Failed to acquire lock for "${targetPath}" within ${timeoutMs}ms.`);
}

/**
 * Executes an operation within a file lock.
 */
export async function withFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const release = await acquireLock(targetPath, options);
  try {
    return await operation();
  } finally {
    await release();
  }
}

/**
 * High-level vault lock for operations that affect the entire vault structure
 * (e.g. bulk ingestion, second brain audit, re-indexing).
 */
export async function withVaultLock<T>(
  vaultPath: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const globalLockTarget = path.join(path.resolve(vaultPath), '.vault-lock');
  return withFileLock(globalLockTarget, operation, options);
}
