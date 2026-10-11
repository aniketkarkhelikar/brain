import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ModelMessage } from 'ai';
import {
  offloadToScratchpad,
  readScratchpad,
  clearOldScratchpads,
  MAX_INLINE_CHARS,
  getScratchDir,
} from './scratchpad.js';
import { pruneStepMessages } from './context-pruner.js';
import { scratchpadRead } from '../tools/scratchpad-read.js';

test('reasoning scratchpad and context window pruner', async (t) => {
  const tempScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-scratch-test-'));
  const oldScratchEnv = process.env.SCRATCH_PATH;
  process.env.SCRATCH_PATH = tempScratch;

  t.after(async () => {
    if (oldScratchEnv !== undefined) process.env.SCRATCH_PATH = oldScratchEnv;
    else delete process.env.SCRATCH_PATH;
    await fs.rm(tempScratch, { recursive: true, force: true });
  });

  await t.test('keeps small outputs inline without offloading', async () => {
    const smallText = 'Simple tool output with useful short data.';
    const res = await offloadToScratchpad('vaultRead', smallText);
    assert.equal(res.isOffloaded, false);
    assert.equal(res.preview, smallText);
    assert.equal(res.scratchPath, '');
  });

  await t.test('offloads oversized outputs to disk and returns memory pointer', async () => {
    const largeText = 'A'.repeat(MAX_INLINE_CHARS + 500);
    const res = await offloadToScratchpad('webRead', largeText);
    assert.equal(res.isOffloaded, true);
    assert.ok(res.scratchPath.length > 0);
    assert.ok(res.preview.length <= 500);
    assert.equal(res.totalChars, MAX_INLINE_CHARS + 500);

    // Verify file actually exists on disk
    const content = await fs.readFile(path.resolve(process.cwd(), res.scratchPath), 'utf8');
    assert.equal(content, largeText);
  });

  await t.test('reads offloaded scratchpad with bounds and blocks traversal', async () => {
    const raw = 'Header\n' + 'Content line.\n'.repeat(50);
    const saved = await offloadToScratchpad('testTool', raw, { maxInlineChars: 50 });
    assert.equal(saved.isOffloaded, true);

    const readRes = await readScratchpad(saved.scratchPath, { startChar: 0, maxChars: 30 });
    assert.equal(readRes.success, true);
    assert.equal(readRes.content?.length, 30);

    // Directory traversal attempt
    const traversal = await readScratchpad('../../etc/passwd');
    assert.equal(traversal.success, false);
    assert.match(traversal.error || '', /traverses outside/);
  });

  await t.test('scratchpadRead tool executes properly', async () => {
    const sample = 'Line 1\nLine 2\nLine 3\n' + 'More data...'.repeat(300);
    const ref = await offloadToScratchpad('sampleTool', sample, { maxInlineChars: 100 });

    const toolResult = await (scratchpadRead as any).execute({
      scratchPath: ref.scratchPath,
      startChar: 0,
      maxChars: 50,
    });

    assert.equal(toolResult.success, true);
    assert.equal(toolResult.content?.length, 50);
    assert.equal(toolResult.hasMore, true);
  });

  await t.test('pruneStepMessages replaces oversized tool results with pointers', async () => {
    const hugePayload = 'W'.repeat(MAX_INLINE_CHARS + 1000);
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Research topic' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'webRead',
            output: {
              type: 'json',
              value: {
                success: true,
                content: hugePayload,
              },
            },
          },
        ],
      },
    ];

    const pruned = await pruneStepMessages(messages);
    assert.equal(pruned.length, 2);

    const toolMsg = pruned[1];
    assert.equal(toolMsg.role, 'tool');
    const part = (toolMsg.content as any[])[0];
    const val = part.output.value;
    assert.equal(val.isOffloaded, true);
    assert.ok(val.content.includes('[Offloaded to Scratchpad:'));
    assert.ok(val.content.includes(val.scratchPath));
  });

  await t.test('clears expired scratchpad files', async () => {
    const scratchDir = getScratchDir();
    const oldFile = path.join(scratchDir, 'old_scratch_123.md');
    await fs.writeFile(oldFile, 'old data');

    // Artificial mtime 30 hours ago
    const pastTime = (Date.now() - 30 * 60 * 60 * 1000) / 1000;
    await fs.utimes(oldFile, pastTime, pastTime);

    const deleted = await clearOldScratchpads(24);
    assert.ok(deleted >= 1);
  });
});
