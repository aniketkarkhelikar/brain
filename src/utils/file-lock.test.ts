import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, withFileLock, withVaultLock, lockFilePath } from './file-lock.js';

test('file lock utility', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-lock-test-'));

  t.after(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  await t.test('acquires and releases file lock cleanly', async () => {
    const targetFile = path.join(temporaryDirectory, 'test-file.md');
    let insideLock = false;

    await withFileLock(targetFile, async () => {
      insideLock = true;
      const lockPath = lockFilePath(targetFile);
      const stat = await fs.stat(lockPath);
      assert.ok(stat.isFile());
    });

    assert.equal(insideLock, true);
    // Lock file should be removed upon release
    const exists = await fs.access(lockFilePath(targetFile)).then(() => true).catch(() => false);
    assert.equal(exists, false);
  });

  await t.test('serializes concurrent operations without collision', async () => {
    const targetFile = path.join(temporaryDirectory, 'shared-resource.md');
    let inCriticalSection = 0;
    let maxConcurrent = 0;

    const op = async () => {
      await withFileLock(targetFile, async () => {
        inCriticalSection++;
        maxConcurrent = Math.max(maxConcurrent, inCriticalSection);
        await new Promise((r) => setTimeout(r, 30));
        inCriticalSection--;
      });
    };

    await Promise.all([op(), op(), op()]);
    assert.equal(maxConcurrent, 1);
    assert.equal(inCriticalSection, 0);
  });

  await t.test('recovers from a stale lock created by a dead process or expired timestamp', async () => {
    const targetFile = path.join(temporaryDirectory, 'stale-test.md');
    const lockPath = lockFilePath(targetFile);

    // Create a fake stale lock with timestamp 60 seconds ago and non-existent PID
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 9999999, createdAt: Date.now() - 60_000, target: targetFile }),
      'utf8',
    );

    let acquired = false;
    await withFileLock(targetFile, async () => {
      acquired = true;
    }, { staleMs: 100, timeoutMs: 1000 });

    assert.equal(acquired, true);
  });

  await t.test('withVaultLock establishes global lock on vault folder', async () => {
    const vaultDir = path.join(temporaryDirectory, 'my-vault');
    await fs.mkdir(vaultDir, { recursive: true });

    let ran = false;
    await withVaultLock(vaultDir, async () => {
      ran = true;
      const lockStat = await fs.stat(path.join(vaultDir, '.vault-lock.lock'));
      assert.ok(lockStat.isFile());
    });
    assert.equal(ran, true);
  });
});
