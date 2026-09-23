import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { indexVault, searchVault } from './memory/search.js';

const previousVaultPath = process.env.VAULT_PATH;
const previousMemoryDb = process.env.BRAIN_MEMORY_DB;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-memory-live-'));
const vaultPath = path.join(tempRoot, 'vault');
process.env.VAULT_PATH = vaultPath;
process.env.BRAIN_MEMORY_DB = path.join(tempRoot, 'state', 'memory.sqlite');

try {
  await fs.mkdir(path.join(vaultPath, 'Work', 'projects'), { recursive: true });
  await fs.mkdir(path.join(vaultPath, 'Knowledgebase', 'concepts'), { recursive: true });
  await fs.writeFile(path.join(vaultPath, 'index.md'), '# Vault Index\n\n## Structure\n\nHuman-maintained overview.\n\n## Wiki Pages\n\n_No pages yet._\n');
  await fs.writeFile(
    path.join(vaultPath, 'Work', 'projects', 'mobility.md'),
    '---\ntitle: Cleaner commuting\ndescription: Lower-emission ways to travel to work.\ntags: [mobility, sustainability]\n---\n\n# Cleaner commuting\n\nCycling, walking, and public transit are lower-emission alternatives to driving a car for the daily commute.\n',
  );
  await fs.writeFile(
    path.join(vaultPath, 'Knowledgebase', 'concepts', 'cooking.md'),
    '# Sourdough\n\nA flour and water starter ferments yeast to make sourdough bread.\n',
  );
  await fs.writeFile(
    path.join(vaultPath, 'Work', 'projects', 'archive.md'),
    '# Archive lookup\n\nExact tracking reference: FERN_ARCHIVE_77.\n',
  );

  const initial = await indexVault();
  assert.equal(initial.filesFound, 3);
  assert.equal(initial.filesAdded, 3);
  assert.ok(initial.embeddingDimensions > 0);
  const semantic = await searchVault('How can I get to the office without relying on a car?', 5);
  assert.equal(semantic.results[0]?.path, 'Work/projects/mobility.md');
  assert.equal(semantic.results[0]?.title, 'Cleaner commuting');
  assert.match(semantic.results[0]?.description ?? '', /Lower-emission/);
  const keyword = await searchVault('FERN_ARCHIVE_77', 5);
  assert.equal(keyword.results[0]?.path, 'Work/projects/archive.md');

  const unchanged = await indexVault();
  assert.equal(unchanged.filesUnchanged, 3);
  assert.equal(unchanged.chunksIndexed, 0);
  const catalog = await fs.readFile(path.join(vaultPath, 'index.md'), 'utf8');
  assert.match(catalog, /Cleaner commuting \(mobility\.md\)/);
  assert.match(catalog, /Lower-emission ways to travel to work/);
  assert.match(catalog, /`Work\/projects\/mobility\.md`/);
  assert.match(catalog, /Human-maintained overview/);
  console.log(`Live hybrid search passed: semantic and exact-keyword queries, ${initial.filesFound} indexed files, ${initial.embeddingDimensions}-dimension vectors.`);
} finally {
  if (previousVaultPath === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = previousVaultPath;
  if (previousMemoryDb === undefined) delete process.env.BRAIN_MEMORY_DB;
  else process.env.BRAIN_MEMORY_DB = previousMemoryDb;
  await fs.rm(tempRoot, { recursive: true, force: true });
}
