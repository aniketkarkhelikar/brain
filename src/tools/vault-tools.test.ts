import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { type Tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { allTools, initialVaultRoute, loadVaultContext } from '../agent.js';
import { vaultList } from './vault-list.js';
import { vaultRead } from './vault-read.js';
import { createVaultSearchTool, vaultSearch } from './vault-search.js';
import { readVaultFileIfSmall, searchVaultFiles } from './vault-fs.js';
import { vaultWrite } from './vault-write.js';
import { vaultCatalog } from './vault-catalog.js';
import { vaultPatch } from './vault-patch.js';
import { vaultMeta } from './vault-meta.js';

let tempRoot = '';
let vaultRoot = '';
let outsideFile = '';
let previousVaultPath: string | undefined;

const toolOptions = { toolCallId: 'test-call', messages: [] as ModelMessage[], context: {} };
const lexicalTestSearch = createVaultSearchTool(async (query, maxResults) => {
  const { totalMatches, results } = await searchVaultFiles(query, maxResults);
  return {
    success: true,
    query,
    totalMatches,
    truncated: totalMatches > results.length,
    results: results.map(({ file, matches }) => ({
      file,
      path: file,
      title: file,
      description: '',
      tags: [],
      chunkIndex: 0,
      score: 1,
      snippet: matches[0] ?? '',
      matches,
    })),
  };
});

async function runTool(definition: Tool, input: unknown): Promise<unknown> {
  const parsedInput = (definition.inputSchema as z.ZodType).parse(input);
  assert.ok(definition.execute, 'tool must have an execute function');
  return definition.execute(parsedInput, toolOptions);
}

async function makeFixtures(): Promise<void> {
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(vaultRoot, 'Knowledgebase', 'concepts'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'Work', 'projects'), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, 'MEMORY.md'),
    '# Graph knowledge\nA persistent structured wiki.\nA [[graph]] connects useful concepts.\nThe structured wiki grows over time.\n',
  );
  await fs.writeFile(
    path.join(vaultRoot, 'Knowledgebase', 'concepts', 'graph.md'),
    '# Knowledge graph\nThe structured wiki links related notes.\nGraph search is case-insensitive.\n',
  );
  await fs.writeFile(
    path.join(vaultRoot, 'Work', 'projects', 'launch.md'),
    '# Launch\nThe project uses a structured wiki for its knowledge base.\n',
  );
  await fs.writeFile(path.join(vaultRoot, '.hidden.md'), 'structured wiki hidden content\n');
  await fs.writeFile(outsideFile, 'outside secret must not be read or changed\n');
  await fs.symlink(outsideFile, path.join(vaultRoot, 'linked-secret.md'));
  await fs.symlink(tempRoot, path.join(vaultRoot, 'linked-directory'));
}

describe('Phase 3 vault tools', () => {
  before(async () => {
    previousVaultPath = process.env.VAULT_PATH;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-tools-'));
    vaultRoot = path.join(tempRoot, 'vault');
    outsideFile = path.join(tempRoot, 'outside-secret.md');
    process.env.VAULT_PATH = vaultRoot;
    await makeFixtures();
  });

  beforeEach(makeFixtures);

  after(async () => {
    if (previousVaultPath === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = previousVaultPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('registers the vault inventory route and loads the configured vault context', async () => {
    assert.deepEqual(Object.keys(allTools).sort(), [
      'memoryAudit', 'skillLoad', 'vaultCatalog', 'vaultList', 'vaultMeta', 'vaultPatch', 'vaultRead', 'vaultSearch', 'vaultWrite', 'webRead', 'webSearch',
    ].sort());
    const context = await loadVaultContext();
    assert.match(context, /=== SOUL\.md === \(not found\)/);
    assert.match(context, /=== MEMORY\.md ===/);
    assert.match(context, /Graph knowledge/);
  });

  it('reads the full generated catalog and deterministically routes inventory prompts to it', async () => {
    await fs.writeFile(path.join(vaultRoot, 'index.md'), '# Vault Index\n\n| Project | Description |\n| --- | --- |\n| Launch | Current launch project |\n');
    assert.deepEqual(await runTool(vaultCatalog, {}), {
      success: true,
      path: 'index.md',
      content: '# Vault Index\n\n| Project | Description |\n| --- | --- |\n| Launch | Current launch project |\n',
    });
    assert.equal(initialVaultRoute('What projects am I working on?'), 'vaultCatalog');
    assert.equal(initialVaultRoute('What did I decide about the database?'), 'vaultSearch');
    assert.equal(initialVaultRoute('What do you know about me?'), undefined);
    assert.equal(initialVaultRoute('What is my communication style?'), undefined);
    assert.equal(initialVaultRoute('Use vaultSearch to find the database decision.'), undefined);
    assert.equal(initialVaultRoute('hello'), undefined);
  });

  it('reads existing files and returns a safe error for missing files', async () => {
    assert.deepEqual(await runTool(vaultRead, { filePath: 'MEMORY.md' }), {
      success: true,
      path: 'MEMORY.md',
      content: '# Graph knowledge\nA persistent structured wiki.\nA [[graph]] connects useful concepts.\nThe structured wiki grows over time.\n',
      charCount: 123,
    });
    assert.equal(await readVaultFileIfSmall('MEMORY.md', 123), '# Graph knowledge\nA persistent structured wiki.\nA [[graph]] connects useful concepts.\nThe structured wiki grows over time.\n');
    assert.equal(await readVaultFileIfSmall('MEMORY.md', 122), undefined);
    const missing = await runTool(vaultRead, { filePath: 'missing.md' }) as { success: boolean; error: string };
    assert.equal(missing.success, false);
    assert.match(missing.error, /does not exist/);
    assert.doesNotMatch(missing.error, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('rejects absolute, traversal, Windows, and symlink reads', async () => {
    for (const filePath of ['../outside-secret.md', outsideFile, String.raw`C:\Users\secret.md`, 'linked-secret.md', 'linked-directory/outside-secret.md']) {
      const result = await runTool(vaultRead, { filePath }) as { success: boolean; error: string };
      assert.equal(result.success, false, `expected ${filePath} to be denied`);
    }
  });

  it('writes nested files, overwrites, appends cleanly, and reports bytes written', async () => {
    const created = await runTool(vaultWrite, {
      filePath: 'Knowledgebase/entities/maya.md',
      content: '# Maya\n',
      mode: 'write',
    }) as { success: boolean; bytesWritten: number };
    assert.equal(created.success, true);
    assert.equal(created.bytesWritten, Buffer.byteLength('# Maya\n'));
    assert.equal(await fs.readFile(path.join(vaultRoot, 'Knowledgebase', 'entities', 'maya.md'), 'utf8'), '# Maya\n');

    await runTool(vaultWrite, { filePath: 'MEMORY.md', content: 'replacement', mode: 'write' });
    assert.equal(await fs.readFile(path.join(vaultRoot, 'MEMORY.md'), 'utf8'), 'replacement');

    await runTool(vaultWrite, { filePath: 'MEMORY.md', content: 'appended', mode: 'append' });
    assert.equal(await fs.readFile(path.join(vaultRoot, 'MEMORY.md'), 'utf8'), 'replacement\nappended');

    await runTool(vaultWrite, { filePath: 'MEMORY.md', content: '', mode: 'append' });
    assert.equal(await fs.readFile(path.join(vaultRoot, 'MEMORY.md'), 'utf8'), 'replacement\nappended');

    await runTool(vaultWrite, { filePath: 'empty.md', content: 'first', mode: 'append' });
    assert.equal(await fs.readFile(path.join(vaultRoot, 'empty.md'), 'utf8'), 'first');
  });

  it('refuses writes outside the vault and through symlinks', async () => {
    for (const filePath of ['../outside-secret.md', 'linked-secret.md', 'linked-directory/created.md']) {
      const result = await runTool(vaultWrite, { filePath, content: 'overwrite attempt', mode: 'write' }) as { success: boolean };
      assert.equal(result.success, false, `expected ${filePath} to be denied`);
    }
    assert.equal(await fs.readFile(outsideFile, 'utf8'), 'outside secret must not be read or changed\n');
  });

  it('applies only unique exact patches and preserves the rest of a note', async () => {
    const original = '# Launch\n\nStatus: active\nOwner: Maya\nBackup owner: Maya\n';
    const file = path.join(vaultRoot, 'Work', 'projects', 'launch.md');
    await fs.writeFile(file, original);
    assert.deepEqual(await runTool(vaultPatch, {
      filePath: 'Work/projects/launch.md', search: 'Status: active', replace: 'Status: complete',
    }), { success: true, path: 'Work/projects/launch.md', replacements: 1 });
    assert.equal(await fs.readFile(file, 'utf8'), original.replace('Status: active', 'Status: complete'));
    const ambiguous = await runTool(vaultPatch, {
      filePath: 'Work/projects/launch.md', search: 'Maya', replace: 'Rae',
    }) as { success: boolean; error: string };
    assert.equal(ambiguous.success, false);
    assert.match(ambiguous.error, /appears 2 times/);
    const explicitMultiple = await runTool(vaultPatch, {
      filePath: 'Work/projects/launch.md', search: 'Maya', replace: 'Rae', allowMultiple: true,
    }) as { success: boolean; replacements: number };
    assert.equal(explicitMultiple.success, true);
    assert.equal(explicitMultiple.replacements, 2);
    const stale = await runTool(vaultPatch, {
      filePath: 'Work/projects/launch.md', search: 'Status: active', replace: 'Status: closed',
    }) as { success: boolean; error: string };
    assert.equal(stale.success, false);
    assert.match(stale.error, /not found/);
    const outside = await runTool(vaultPatch, {
      filePath: '../outside-secret.md', search: 'outside', replace: 'changed',
    }) as { success: boolean };
    assert.equal(outside.success, false);
  });

  it('reads and updates frontmatter while leaving note content unchanged', async () => {
    const target = path.join(vaultRoot, 'Knowledgebase', 'concepts', 'graph.md');
    const body = '\n# Knowledge graph\nThe structured wiki links related notes.\nGraph search is case-insensitive.\n';
    await fs.writeFile(target, `---\ntitle: Knowledge graph\ntags: [memory]\n---${body}`);
    const read = await runTool(vaultMeta, { filePath: 'Knowledgebase/concepts/graph.md' }) as { success: boolean; metadata: Record<string, unknown> };
    assert.equal(read.success, true);
    assert.equal(read.metadata.title, 'Knowledge graph');
    const updated = await runTool(vaultMeta, {
      filePath: 'Knowledgebase/concepts/graph.md', updates: { status: 'active', tags: ['memory', 'graph'] },
    }) as { success: boolean; metadata: Record<string, unknown> };
    assert.equal(updated.success, true);
    assert.equal(updated.metadata.status, 'active');
    assert.match(await fs.readFile(target, 'utf8'), /# Knowledge graph\nThe structured wiki links related notes/);
    const traversal = await runTool(vaultMeta, { filePath: '../outside-secret.md' }) as { success: boolean };
    assert.equal(traversal.success, false);
  });

  it('lists the root and nested folders deterministically while hiding hidden files and symlinks', async () => {
    const root = await runTool(vaultList, { dirPath: '.' }) as { success: boolean; items: Array<{ name: string; type: string }> };
    assert.equal(root.success, true);
    assert.deepEqual(root.items.map(({ name, type }) => [name, type]), [
      ['Knowledgebase', 'directory'],
      ['MEMORY.md', 'file'],
      ['Work', 'directory'],
    ]);

    const nested = await runTool(vaultList, { dirPath: 'Knowledgebase/concepts' }) as { items: Array<{ name: string }> };
    assert.deepEqual(nested.items.map(({ name }) => name), ['graph.md']);

    const escaped = await runTool(vaultList, { dirPath: '../' }) as { success: boolean };
    assert.equal(escaped.success, false);
    const fileAsDirectory = await runTool(vaultList, { dirPath: 'MEMORY.md' }) as { success: boolean };
    assert.equal(fileAsDirectory.success, false);
  });

  it('searches markdown recursively without case sensitivity, caps snippets and reports truncation accurately', async () => {
    const result = await runTool(lexicalTestSearch, { query: 'STRUCTURED WIKI', maxResults: 1 }) as {
      success: boolean;
      totalMatches: number;
      truncated: boolean;
      results: Array<{ file: string; matches: string[] }>;
    };
    assert.equal(result.success, true);
    assert.equal(result.totalMatches, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].file, 'Knowledgebase/concepts/graph.md');

    const full = await runTool(lexicalTestSearch, { query: 'structured wiki' }) as {
      totalMatches: number;
      truncated: boolean;
      results: Array<{ file: string; matches: string[] }>;
    };
    assert.equal(full.totalMatches, 3);
    assert.equal(full.truncated, false);
    assert.equal(full.results.length, 3);

    const outsideOnly = await runTool(lexicalTestSearch, { query: 'outside secret' }) as { totalMatches: number };
    assert.equal(outsideOnly.totalMatches, 0);
  });

  it('validates search inputs and supplies bounded defaults', () => {
    const searchSchema = lexicalTestSearch.inputSchema as z.ZodType;
    const writeSchema = vaultWrite.inputSchema as z.ZodType;
    assert.equal(searchSchema.safeParse({ query: '   ' }).success, false);
    assert.equal(searchSchema.safeParse({ query: 'wiki', maxResults: 0 }).success, false);
    assert.equal(searchSchema.safeParse({ query: 'wiki', maxResults: 51 }).success, false);
    assert.equal(searchSchema.safeParse({ query: 'wiki', maxResults: 1.5 }).success, false);
    assert.equal((searchSchema.parse({ query: 'wiki' }) as { maxResults: number }).maxResults, 10);
    assert.equal((writeSchema.parse({ filePath: 'new.md', content: 'ok' }) as { mode: string }).mode, 'write');
    assert.equal(writeSchema.safeParse({ filePath: 'new.md', content: 'x'.repeat(5_000_001) }).success, false);
  });
});
