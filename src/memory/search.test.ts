import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../providers.js';
import { embeddingModelName } from './embeddings.js';
import { indexVault, searchVault, chunkMarkdown, reciprocalRankFusion } from './search.js';

let tempRoot = '';
let vaultPath = '';
let dbPath = '';
const embeddingModel = 'unit-test-embeddings';
let embeddingInputBatches: string[][] = [];

function fakeEmbeddings(values: string[]): Promise<number[][]> {
  embeddingInputBatches.push(values);
  return Promise.resolve(values.map((value) => {
    const text = value.toLowerCase();
    if (/flux-err-410/.test(text)) return [0, 1, 0];
    if (/operations handbook|general operational reference/.test(text)) return [1, 0, 0];
    if (/bicycle|cycling|public transit|commute|office|car|travel/.test(text)) return [1, 0, 0];
    if (/sourdough|bread|yeast|flour/.test(text)) return [0, 1, 0];
    return [0, 0, 1];
  }));
}

async function writeInitialVault(): Promise<void> {
  await fs.mkdir(path.join(vaultPath, 'Work', 'projects'), { recursive: true });
  await fs.mkdir(path.join(vaultPath, 'Personal_context', 'journal'), { recursive: true });
  await fs.writeFile(path.join(vaultPath, 'index.md'), '# Vault Index\n\n## Structure\n\n- Human-maintained introduction stays here.\n\n## Wiki Pages\n\n_No pages created yet._\n');
  await fs.writeFile(
    path.join(vaultPath, 'Work', 'projects', 'commute.md'),
    '---\ntitle: Low-carbon commuting\ndescription: Ways to travel to work with less pollution.\ntags:\n  - mobility\n  - sustainability\n---\n\n# Low-carbon commuting\n\nCycling, walking, and public transit are lower-emission alternatives to driving a car for the daily commute.\n',
  );
  await fs.writeFile(
    path.join(vaultPath, 'Personal_context', 'journal', 'cooking.md'),
    '# Sourdough bread\n\nA starter made from flour and water ferments yeast for a loaf of sourdough bread.\n',
  );
  await fs.writeFile(
    path.join(vaultPath, 'Work', 'projects', 'operations.md'),
    '---\ntitle: Operations handbook\ndescription: General operational reference.\n---\n\n# Operations handbook\n\nGeneral operational notes for routine maintenance.\n\nAn old incident recorded the exact response code FLUX-ERR-410 during the service restart.\n',
  );
  await fs.writeFile(path.join(vaultPath, '.hidden.md'), 'hidden bicycle note\n');
  await fs.writeFile(path.join(tempRoot, 'outside.md'), '# Outside\n\npublic transit private test\n');
  await fs.symlink(path.join(tempRoot, 'outside.md'), path.join(vaultPath, 'outside-link.md'));
}

const searchOptions = () => ({ vaultPath, dbPath, model: embeddingModel, embeddingDimensions: 3, embedMany: fakeEmbeddings });

describe('Phase 5 hybrid vault search and indexing', () => {
  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-rag-'));
    vaultPath = path.join(tempRoot, 'vault');
    dbPath = path.join(tempRoot, 'state', 'memory.sqlite');
    embeddingInputBatches = [];
    await writeInitialVault();
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('chunks Markdown to a bounded size with overlap and handles empty text', () => {
    const text = Array.from({ length: 300 }, (_, index) => `word${index}`).join(' ');
    const chunks = chunkMarkdown(text, 160, 32);
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((chunk) => chunk.content.length <= 160));
    assert.ok(chunks[0].endOffset > chunks[1].startOffset);
    assert.ok(chunks[1].endOffset - chunks[1].startOffset > 0);
    assert.deepEqual(chunkMarkdown('  \n  '), []);
    assert.throws(() => chunkMarkdown(text, 10, 2), /at least 32/);
    assert.throws(() => chunkMarkdown(text, 64, 64), /smaller than targetChars/);
  });

  it('fuses source rankings without comparing incompatible raw BM25 and cosine scales', () => {
    const scores = reciprocalRankFusion([[1, 2, 3], [2, 1], [4, 2]]);
    assert.ok((scores.get(2) ?? 0) > (scores.get(1) ?? 0));
    assert.ok((scores.get(1) ?? 0) > (scores.get(3) ?? 0));
    assert.equal(scores.get(4), 1 / 61);
    assert.equal(reciprocalRankFusion([[1, 1, 2]]).get(1), 1 / 61);
  });

  it('indexes Markdown metadata, creates the structured file catalog, and skips hidden files/symlinks', async () => {
    const stats = await indexVault(searchOptions());
    assert.deepEqual(
      [stats.filesFound, stats.filesAdded, stats.filesUpdated, stats.filesUnchanged, stats.filesDeleted],
      [3, 3, 0, 0, 0],
    );
    assert.equal(stats.embeddingModel, embeddingModel);
    assert.equal(stats.embeddingDimensions, 3);
    assert.equal(stats.chunksIndexed, 3);
    assert.ok(embeddingInputBatches.length > 0);

    const catalog = await fs.readFile(path.join(vaultPath, 'index.md'), 'utf8');
    assert.match(catalog, /Human-maintained introduction stays here/);
    assert.match(catalog, /\| File \| Description \| Relative path \|/);
    assert.match(catalog, /Low-carbon commuting \(commute\.md\)/);
    assert.match(catalog, /Ways to travel to work with less pollution/);
    assert.match(catalog, /`Work\/projects\/commute\.md`/);
    assert.doesNotMatch(catalog, /outside-link|hidden\.md/);
    assert.doesNotMatch(catalog, /No pages created yet/);
  });

  it('combines semantic vector retrieval and exact FTS5 terms, returning useful metadata and snippets', async () => {
    const semantic = await searchVault('How can I get to the office without relying on my own car?', 5, searchOptions());
    assert.equal(semantic.success, true);
    assert.equal(semantic.results[0]?.path, 'Work/projects/commute.md');
    assert.equal(semantic.results[0]?.title, 'Low-carbon commuting');
    assert.match(semantic.results[0]?.description ?? '', /less pollution/);
    assert.match(semantic.results[0]?.snippet ?? '', /commute/i);

    const keyword = await searchVault('ferments yeast loaf', 5, searchOptions());
    assert.equal(keyword.results[0]?.path, 'Personal_context/journal/cooking.md');
    assert.ok(keyword.results[0].score > 0);
    assert.deepEqual(keyword.results[0].matches, [keyword.results[0].snippet]);
  });

  it('finds a buried exact identifier through global chunk retrieval when its file profile does not mention it', async () => {
    const result = await searchVault('FLUX-ERR-410', 5, searchOptions());
    assert.equal(result.results[0]?.path, 'Work/projects/operations.md');
    assert.match(result.results[0]?.snippet ?? '', /FLUX-ERR-410/);
  });

  it('returns no candidates when lexical metadata and semantic similarity provide no useful evidence', async () => {
    const noMatchVault = path.join(tempRoot, 'no-match-vault');
    const noMatchDb = path.join(tempRoot, 'no-match-state', 'memory.sqlite');
    await fs.mkdir(noMatchVault, { recursive: true });
    await fs.writeFile(path.join(noMatchVault, 'field-guide.md'), '# Cat care guide\n\nA short guide to feeding and grooming a cat.\n');
    const noMatch = await searchVault('What explains quantum orbital sculpture?', 5, {
      vaultPath: noMatchVault,
      dbPath: noMatchDb,
      model: 'unit-test-no-match',
      embeddingDimensions: 4,
      embedMany: async (values) => values.map((value) => /quantum orbital sculpture/i.test(value)
        ? [0, 1, 0, 0]
        : [1, 0, 0, 0]),
    });
    assert.deepEqual(noMatch.results, []);
    assert.equal(noMatch.totalMatches, 0);
  });

  it('applies path scopes before KNN limits so many raw Inbox notes cannot crowd out compiled pages', async () => {
    const scopedVault = path.join(tempRoot, 'scoped-vault');
    const scopedDb = path.join(tempRoot, 'scoped-state', 'memory.sqlite');
    await fs.mkdir(path.join(scopedVault, 'Inbox', 'notes'), { recursive: true });
    await fs.mkdir(path.join(scopedVault, 'Work', 'projects'), { recursive: true });
    await fs.writeFile(path.join(scopedVault, 'Work', 'projects', 'orbit.md'), '# Orbit notebook\n\nShared archived material for this collection.\n');
    await Promise.all(Array.from({ length: 100 }, (_, index) => fs.writeFile(
      path.join(scopedVault, 'Inbox', 'notes', `source-${String(index).padStart(3, '0')}.md`),
      `# Source ${index}\n\nShared archived material for this collection.\n`,
    )));
    const scoped = await searchVault('obscure planetary observation', 5, {
      vaultPath: scopedVault,
      dbPath: scopedDb,
      model: 'unit-test-scoped-knn',
      embeddingDimensions: 3,
      embedMany: async (values) => values.map(() => [1, 0, 0]),
      includePrefixes: ['Work'],
    });
    assert.equal(scoped.results[0]?.path, 'Work/projects/orbit.md');
  });

  it('does not re-embed unchanged files; updates changed, adds new, and removes deleted documents', async () => {
    const before = embeddingInputBatches.flat().length;
    const unchanged = await indexVault(searchOptions());
    assert.equal(unchanged.filesUnchanged, 3);
    assert.equal(unchanged.chunksIndexed, 0);
    assert.equal(embeddingInputBatches.flat().length, before);

    await fs.writeFile(path.join(vaultPath, 'Work', 'projects', 'commute.md'), '# Commute update\n\nAn electric bicycle provides a clean route to the office.\n');
    await fs.writeFile(path.join(vaultPath, 'Work', 'projects', 'water.md'), '# Water project\n\nA rain barrel stores roof runoff for a garden.\n');
    await fs.unlink(path.join(vaultPath, 'Personal_context', 'journal', 'cooking.md'));

    const updated = await indexVault(searchOptions());
    assert.deepEqual(
      [updated.filesFound, updated.filesAdded, updated.filesUpdated, updated.filesUnchanged, updated.filesDeleted],
      [3, 1, 1, 1, 1],
    );
    const search = await searchVault('electric bicycle', 10, searchOptions());
    assert.equal(search.results[0]?.path, 'Work/projects/commute.md');
    assert.doesNotMatch(JSON.stringify(search.results), /cooking\.md/);
    const catalog = await fs.readFile(path.join(vaultPath, 'index.md'), 'utf8');
    assert.match(catalog, /Work\/projects\/water\.md/);
    assert.doesNotMatch(catalog, /cooking\.md/);
  });

  it('automatically reindexes edits before the next search and isolates an embedding-model change', async () => {
    const changedOptions = searchOptions();
    let alternateModelEmbeddingCount = 0;
    await fs.writeFile(path.join(vaultPath, 'Work', 'projects', 'water.md'), '# Water project\n\nThe cistern collects rainfall for dry summer gardens.\n');
    const changed = await searchVault('cistern collects rain', 10, changedOptions);
    assert.equal(changed.results[0]?.path, 'Work/projects/water.md');

    const nextModelOptions = {
      ...searchOptions(),
      model: 'unit-test-embeddings-v2',
      embeddingDimensions: 2,
      embedMany: async (values: string[]) => {
        alternateModelEmbeddingCount += values.length;
        return values.map((value) => /water|rain|cistern/i.test(value) ? [1, 0] : [0, 1]);
      },
    };
    const switched = await searchVault('rain water storage', 10, nextModelOptions);
    assert.equal(switched.results[0]?.path, 'Work/projects/water.md');
    const stillCurrent = await indexVault(nextModelOptions);
    assert.equal(stillCurrent.filesUnchanged, 3);
    const beforeRepair = alternateModelEmbeddingCount;

    const damagedDatabase = new Database(dbPath);
    sqliteVec.load(damagedDatabase);
    damagedDatabase.exec('DROP TABLE memory_vectors; CREATE VIRTUAL TABLE memory_vectors USING vec0(embedding float[2] distance_metric=cosine); DELETE FROM memory_chunks_fts;');
    damagedDatabase.close();

    const repaired = await indexVault(nextModelOptions);
    assert.equal(repaired.filesUpdated, 3);
    assert.equal(repaired.filesUnchanged, 0);
    assert.ok(alternateModelEmbeddingCount > beforeRepair);
  });

  it('uses the planned Ollama MiniLM default and 384-dimensional production vectors', () => {
    assert.equal(embeddingModelName(), 'all-minilm:l6-v2');
    assert.equal(DEFAULT_EMBEDDING_DIMENSIONS, 384);
  });

  it('rejects a production embedding model that does not return the planned 384 dimensions', async () => {
    const mismatchDbPath = path.join(tempRoot, 'mismatch-state', 'memory.sqlite');
    await assert.rejects(
      indexVault({
        vaultPath,
        dbPath: mismatchDbPath,
        model: 'all-minilm:l6-v2',
        embedMany: async (values) => values.map(() => [1, 0, 0]),
      }),
      /must return 384-dimensional vectors; received 3/,
    );
  });

  it('subdivides only chunks Ollama rejects for exceeding its context window', async () => {
    const adaptiveVault = path.join(tempRoot, 'adaptive-vault');
    const adaptiveDbPath = path.join(tempRoot, 'adaptive-state', 'memory.sqlite');
    await fs.mkdir(adaptiveVault, { recursive: true });
    await fs.writeFile(path.join(adaptiveVault, 'long.md'), `# Long note\n\n${'word '.repeat(300)}\n`);
    let embeddingCalls = 0;
    const stats = await indexVault({
      vaultPath: adaptiveVault,
      dbPath: adaptiveDbPath,
      model: 'unit-test-context-limit',
      embeddingDimensions: 3,
      embedMany: async (values) => {
        embeddingCalls += 1;
        if (values.some((value) => value.length > 700)) {
          throw Object.assign(new Error('Bad Request'), {
            statusCode: 400,
            responseBody: '{"error":"the input length exceeds the context length"}',
          });
        }
        return values.map(() => [1, 0, 0]);
      },
    });
    assert.equal(stats.filesAdded, 1);
    assert.ok(stats.chunksIndexed > 1);
    assert.ok(embeddingCalls > 1);
  });
});
