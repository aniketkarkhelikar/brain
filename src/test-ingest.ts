/** Live Ollama Phase 6 check using only a disposable synthetic vault. */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { ingestInbox } from './heartbeat/ingest.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-live-ingest-'));
const vaultPath = path.join(tempRoot, 'vault');
const dbPath = path.join(tempRoot, 'state', 'memory.sqlite');

try {
  await fs.mkdir(path.join(vaultPath, 'Inbox', 'notes'), { recursive: true });
  await fs.mkdir(path.join(vaultPath, 'Work', 'projects'), { recursive: true });
  await fs.writeFile(path.join(vaultPath, 'index.md'), '# Synthetic vault\n');
  await fs.writeFile(
    path.join(vaultPath, 'Work', 'projects', 'fern-731.md'),
    '---\ntitle: FERN-731 Platform Migration\ndescription: Platform migration planning and release decisions.\ntags: [platform, release]\n---\n\n# FERN-731 Platform Migration\n\nThe team is migrating its synthetic reporting service to the new platform. The release freeze date is not yet recorded.\n',
  );
  await fs.writeFile(
    path.join(vaultPath, 'Inbox', 'notes', 'mixed-brain-dump.md'),
    '---\ntitle: FERN-731 release decision and a new concept\nprocessed: false\n---\n\nThe FERN-731 team decided today that the release freeze starts on 2026-10-15. Attribute this decision to the platform team.\n\nSeparately, capture this new concept: shadow traffic compares mirrored production requests without serving the mirror responses, which can help test API changes safely.\n',
  );

  const stats = await ingestInbox({ vaultPath, dbPath });
  if (stats.failed || stats.needsReview) console.error('Live compiler decisions:', JSON.stringify(stats.items, null, 2));
  assert.equal(stats.scanned, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.needsReview, 0);
  assert.equal(stats.created, 1, 'the distinct shadow-traffic concept should get its own note');
  assert.equal(stats.updated, 1);
  const source = matter(await fs.readFile(path.join(vaultPath, 'Inbox', 'notes', 'mixed-brain-dump.md'), 'utf8'));
  assert.equal(source.data.processed, true);
  assert.ok(Array.isArray(source.data.compiled_to));
  assert.ok(source.data.compiled_to.includes('Work/projects/fern-731.md'));
  const createdPath = source.data.compiled_to.find((target: string) => target !== 'Work/projects/fern-731.md');
  assert.equal(typeof createdPath, 'string');
  const project = await fs.readFile(path.join(vaultPath, 'Work', 'projects', 'fern-731.md'), 'utf8');
  assert.match(project, /2026-10-15/);
  assert.match(project, /platform team/i);
  assert.match(project, /\[\[Inbox\/notes\/mixed-brain-dump\]\]/);
  const concept = await fs.readFile(path.join(vaultPath, ...createdPath.split('/')), 'utf8');
  assert.match(concept, /shadow traffic/i);
  assert.match(concept, /\[\[Inbox\/notes\/mixed-brain-dump\]\]/);
  console.log('Live Inbox compiler passed: Qwen split one brain-dump into an additive FERN-731 update and a separate concept note.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live Inbox compiler test failed.');
  process.exitCode = 1;
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
