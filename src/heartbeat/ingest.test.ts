import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { after, before, describe, it } from 'node:test';
import { ingestInbox, type CompilePlan, type CompilePlanBatch, type IngestOptions } from './ingest.js';
import { runHeartbeat } from './heartbeat-agent.js';
import { startHeartbeatSchedule } from './cron.js';

let tempRoot = '';
let vaultPath = '';
let dbPath = '';

async function write(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(vaultPath, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
}

async function archivedInboxPath(sourcePath: string): Promise<string> {
  const relative = sourcePath.replace(/^Inbox\//, '');
  const parsed = path.posix.parse(relative);
  const archiveDirectory = path.join(vaultPath, 'Archive', 'Inbox', ...parsed.dir.split('/').filter(Boolean));
  const entries = await fs.readdir(archiveDirectory);
  const archivedName = entries.find((entry) => entry.startsWith(`${parsed.name}--`) && entry.endsWith(parsed.ext || '.md'));
  assert.ok(archivedName, `expected ${sourcePath} to be archived`);
  return path.join(archiveDirectory, archivedName);
}

async function resetVault(): Promise<void> {
  await fs.rm(vaultPath, { recursive: true, force: true });
  await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  await fs.mkdir(vaultPath, { recursive: true });
  await write('index.md', '# Vault Index\n');
}

function baseOptions(overrides: Partial<IngestOptions> = {}): IngestOptions {
  return {
    vaultPath,
    dbPath,
    model: 'test-ingest-embeddings',
    embeddingDimensions: 3,
    embedMany: async (values) => values.map(() => [0, 0, 1]),
    ...overrides,
  };
}

function emptySearch() {
  return async (_query: string, _limit: number, options: { includePrefixes?: string[] }) => {
    assert.deepEqual(options.includePrefixes, ['Knowledgebase', 'Work', 'Personal_context']);
    return { success: true as const, query: _query, totalMatches: 0, truncated: false, results: [] };
  };
}

describe('Phase 6 Inbox compiler and heartbeat', () => {
  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-ingest-'));
    vaultPath = path.join(tempRoot, 'vault');
    dbPath = path.join(tempRoot, 'state', 'memory.sqlite');
    await fs.mkdir(vaultPath, { recursive: true });
    await write('index.md', '# Vault Index\n');
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('creates and additively updates wiki notes, keeps provenance, and is idempotent across reruns', async () => {
    await resetVault();
    await write('Work/projects/commute.md', '# Commuting Project\n\nExisting project facts stay intact.\n');
    await write('Inbox/notes/new-concept.md', '---\nprocessed: false\n---\n\nA new idea about personal knowledge systems.\n');
    await write('Inbox/notes/commute-update.md', '---\nprocessed: false\n---\n\nThe commuting project now plans to use an electric bicycle.\n');
    const generatedSources: string[] = [];
    const generatePlan: NonNullable<IngestOptions['generatePlan']> = async ({ sourcePath }) => {
      generatedSources.push(sourcePath);
      if (sourcePath.endsWith('new-concept.md')) {
        return {
          decision: 'create', targetPath: null, category: 'Knowledgebase/concepts',
          title: 'Personal Knowledge Systems', summary: 'A reusable concept note.',
          body: 'Personal knowledge systems collect and connect durable ideas.', rationale: 'No existing concept covers this.',
        };
      }
      return {
        decision: 'update', targetPath: 'Work/projects/commute.md', category: null,
        title: 'Commuting Project', summary: '',
        body: 'The project now plans to use an electric bicycle.', rationale: 'This is new project information.',
      };
    };
    const search: NonNullable<IngestOptions['search']> = async (query, _limit, options) => {
      assert.deepEqual(options.includePrefixes, ['Knowledgebase', 'Work', 'Personal_context']);
      const matches = /commut|electric/i.test(query);
      return {
        success: true,
        query,
        totalMatches: matches ? 1 : 0,
        truncated: false,
        results: matches ? [{
          file: 'Work/projects/commute.md', path: 'Work/projects/commute.md', title: 'Commuting Project',
          description: 'Project details.', tags: [], chunkIndex: 0, score: 0.5,
          snippet: 'Existing project facts.', matches: ['Existing project facts.'],
        }] : [],
      };
    };
    const options = baseOptions({ search, generatePlan });

    const first = await ingestInbox(options);
    assert.deepEqual([first.scanned, first.created, first.updated, first.failed], [2, 1, 1, 0]);
    assert.equal(generatedSources.length, 2);

    const created = await fs.readFile(path.join(vaultPath, 'Knowledgebase/concepts/personal-knowledge-systems.md'), 'utf8');
    assert.match(created, /Personal knowledge systems collect/);
    assert.match(created, /\[\[Archive\/Inbox\/notes\/new-concept--[a-f0-9]{12}\]\]/);
    assert.match(created, /ai-brain-source-sha256:/);

    const updated = await fs.readFile(path.join(vaultPath, 'Work/projects/commute.md'), 'utf8');
    assert.match(updated, /Existing project facts stay intact/);
    assert.match(updated, /The project now plans to use an electric bicycle/);
    assert.match(updated, /\[\[Archive\/Inbox\/notes\/commute-update--[a-f0-9]{12}\]\]/);

    const archived = matter(await fs.readFile(await archivedInboxPath('Inbox/notes/new-concept.md'), 'utf8'));
    assert.equal(archived.data.processed, true);
    assert.equal(typeof archived.data.processed_hash, 'string');
    const rerun = await ingestInbox(options);
    assert.equal(rerun.scanned, 0, 'archived sources are no longer in the Inbox queue');
    assert.equal(rerun.items.length, 0);
    assert.equal(generatedSources.length, 2);

    const sourcePath = await archivedInboxPath('Inbox/notes/new-concept.md');
    const source = matter(await fs.readFile(sourcePath, 'utf8'));
    for (const key of ['processed', 'processed_hash', 'processed_at', 'ingestion_status', 'compiled_to']) delete source.data[key];
    await write('Inbox/notes/new-concept-replay.md', matter.stringify(source.content, { ...source.data, processed: false }));
    const recovered = await ingestInbox(options);
    assert.equal(recovered.updated, 1);
    assert.equal(generatedSources.length, 2, 'the provenance marker should recover without another model call');
    assert.ok(await archivedInboxPath('Inbox/notes/new-concept-replay.md'));
    const recoveredPage = await fs.readFile(path.join(vaultPath, 'Knowledgebase/concepts/personal-knowledge-systems.md'), 'utf8');
    assert.equal((recoveredPage.match(/Personal knowledge systems collect/g) ?? []).length, 1);
  });

  it('parks ambiguous or oversized input for review and retries it only when asked', async () => {
    await resetVault();
    await write('Inbox/notes/ambiguous.md', '---\nprocessed: false\n---\n\nA note with unclear destination.\n');
    const plan: CompilePlan = {
      decision: 'needs_review', targetPath: null, category: null,
      title: 'Ambiguous note', summary: '', body: '', rationale: 'The destination is unclear.',
    };
    let planCalls = 0;
    const options = baseOptions({
      search: emptySearch(),
      generatePlan: async () => { planCalls += 1; return plan; },
    });
    const parked = await ingestInbox(options);
    assert.equal(parked.needsReview, 1);
    assert.equal(planCalls, 1);
    const repeated = await ingestInbox(options);
    assert.equal(repeated.needsReview, 1);
    assert.equal(planCalls, 1);

    const retry = await ingestInbox({
      ...options,
      retryNeedsReview: true,
      generatePlan: async () => {
        planCalls += 1;
        return {
          decision: 'create', targetPath: null, category: 'Knowledgebase/concepts',
          title: 'Resolved Note', summary: '', body: 'Now safely categorized.', rationale: 'User retry requested.',
        };
      },
    });
    assert.equal(retry.created, 1);
    assert.equal(planCalls, 2);

    await write('Inbox/notes/too-large.md', `---\nprocessed: false\n---\n\n${'long '.repeat(4_000)}`);
    const oversized = await ingestInbox(options);
    assert.ok(oversized.items.some((item) => item.source.endsWith('too-large.md') && item.decision === 'needs_review'));
  });

  it('splits a multi-topic brain-dump into separate safe updates and new notes', async () => {
    await resetVault();
    await write('Work/projects/sarah-api.md', '# API timeout bug\n\nSarah is investigating the timeout issue.\n');
    await write('Knowledgebase/concepts/vector-caching.md', '# Vector caching\n\nCache repeated embedding work.\n');
    await write('Inbox/notes/evening-dump.md', [
      'Synced with Sarah on the API timeout bug. We will compare the gateway logs tomorrow.',
      'Also renew the example.test domain before Friday.',
      'New idea: vector caching in Rust could reduce repeated embedding work.',
    ].join('\n\n'));
    let observedQuery = '';
    const candidates = async (query: string) => {
      observedQuery = query;
      return {
        success: true as const,
        query,
        totalMatches: 2,
        truncated: false,
        results: [
          { file: 'Work/projects/sarah-api.md', path: 'Work/projects/sarah-api.md', title: 'API timeout bug', description: 'Sarah is investigating.', tags: [], chunkIndex: 0, score: 0.8, snippet: 'timeout issue', matches: ['timeout issue'] },
          { file: 'Knowledgebase/concepts/vector-caching.md', path: 'Knowledgebase/concepts/vector-caching.md', title: 'Vector caching', description: 'Cache repeated embedding work.', tags: [], chunkIndex: 0, score: 0.7, snippet: 'vector cache', matches: ['vector cache'] },
        ],
      };
    };
    const plan: CompilePlanBatch = {
      items: [
        { decision: 'update', targetPath: 'Work/projects/sarah-api.md', category: null, title: 'API timeout bug', summary: '', body: 'Sarah and the user will compare gateway logs tomorrow.', rationale: 'Same project and issue.' },
        { decision: 'create', targetPath: null, category: 'Work/decisions', title: 'Renew example.test domain', summary: '', body: 'Renew the domain before Friday.', rationale: 'A separate deadline.' },
        { decision: 'create', targetPath: null, category: 'Knowledgebase/concepts', title: 'Rust vector caching idea', summary: '', body: 'Rust vector caching may reduce repeated embedding work.', rationale: 'A separate technical idea.' },
      ],
    };
    const result = await ingestInbox(baseOptions({
      search: candidates,
      generatePlan: async () => plan,
    }));
    assert.equal(result.created, 2, JSON.stringify(result));
    assert.equal(result.updated, 1, JSON.stringify(result));
    assert.equal(result.failed, 0);
    assert.match(observedQuery, /vector caching in Rust/i, 'candidate search should sample the end of the full note');
    assert.match(await fs.readFile(path.join(vaultPath, 'Work/projects/sarah-api.md'), 'utf8'), /compare gateway logs tomorrow/);
    assert.match(await fs.readFile(path.join(vaultPath, 'Work/decisions/renew-example-test-domain.md'), 'utf8'), /before Friday/);
    assert.match(await fs.readFile(path.join(vaultPath, 'Knowledgebase/concepts/rust-vector-caching-idea.md'), 'utf8'), /repeated embedding work/);
    const source = matter(await fs.readFile(await archivedInboxPath('Inbox/notes/evening-dump.md'), 'utf8'));
    assert.equal(source.data.processed, true);
    assert.ok(Array.isArray(source.data.compiled_to));
  });

  it('parks the entire source without partial writes when any decomposed topic is ambiguous', async () => {
    await resetVault();
    await write('Work/projects/server-a.md', '# Server A\n\nProduction host.\n');
    await write('Inbox/notes/mixed.md', 'Update the API project. Also check server 2.\n');
    const result = await ingestInbox(baseOptions({
      search: async () => ({ success: true, query: 'mixed', totalMatches: 1, truncated: false, results: [{
        file: 'Work/projects/server-a.md', path: 'Work/projects/server-a.md', title: 'Server A', description: 'Production host.', tags: [], chunkIndex: 0, score: 0.5, snippet: 'Production host.', matches: ['Production host.'],
      }] }),
      generatePlan: async () => ({ items: [
        { decision: 'update', targetPath: 'Work/projects/server-a.md', category: null, title: 'Server A', summary: '', body: 'A new fact.', rationale: 'Candidate selected.' },
        { decision: 'needs_review', targetPath: null, category: null, title: 'Server 2', summary: '', body: '', rationale: 'Could mean either server.' },
      ] }),
    }));
    assert.equal(result.needsReview, 1);
    assert.equal(await fs.readFile(path.join(vaultPath, 'Work/projects/server-a.md'), 'utf8'), '# Server A\n\nProduction host.\n');
    assert.deepEqual(await fs.readdir(path.join(vaultPath, 'Knowledgebase')).catch(() => []), []);
  });

  it('resumes a multi-note compile from its saved plan after an interrupted partial write', async () => {
    await resetVault();
    const projectPath = 'Work/projects/recovery.md';
    await write(projectPath, '# Recovery project\n\nExisting context.\n');
    await write('Inbox/notes/recovery-dump.md', 'Update the recovery project. Also capture a new compiler idea.\n');
    const plan: CompilePlanBatch = { items: [
      { decision: 'create', targetPath: null, category: 'Knowledgebase/concepts', title: 'Compiler recovery idea', summary: '', body: 'Saved plans make multi-note writes resumable.', rationale: 'A new concept.' },
      { decision: 'update', targetPath: projectPath, category: null, title: 'Recovery project', summary: '', body: 'A compiler idea was captured.', rationale: 'Existing project.' },
    ] };
    let planCalls = 0;
    const options = baseOptions({
      search: async (query) => ({ success: true, query, totalMatches: 1, truncated: false, results: [{
        file: projectPath, path: projectPath, title: 'Recovery project', description: 'Existing context.', tags: [], chunkIndex: 0, score: 0.8, snippet: 'Existing context.', matches: ['Existing context.'],
      }] }),
      generatePlan: async () => {
        planCalls += 1;
        await fs.rm(path.join(vaultPath, projectPath));
        return plan;
      },
    });
    const interrupted = await ingestInbox(options);
    assert.equal(interrupted.failed, 1);
    assert.match(await fs.readFile(path.join(vaultPath, 'Knowledgebase/concepts/compiler-recovery-idea.md'), 'utf8'), /Saved plans/);
    await write(projectPath, '# Recovery project\n\nExisting context.\n');
    await fs.appendFile(path.join(vaultPath, 'Inbox/notes/recovery-dump.md'), '\nAlso add a fact captured after the interrupted run.\n');
    const resumed = await ingestInbox({ ...options, retryNeedsReview: true, generatePlan: async () => { throw new Error('the saved plan should be reused'); } });
    assert.equal(resumed.failed, 0);
    assert.equal(planCalls, 1);
    const updated = await fs.readFile(path.join(vaultPath, projectPath), 'utf8');
    assert.match(updated, /A compiler idea was captured/);
    assert.equal((updated.match(/ai-brain-source-sha256:/g) ?? []).length, 1);
    const source = matter(await fs.readFile(await archivedInboxPath('Inbox/notes/recovery-dump.md'), 'utf8'));
    assert.equal(source.data.processed, true);
    for (const key of ['processed', 'processed_hash', 'processed_at', 'ingestion_status', 'ingestion_note', 'attempted_hash', 'compiled_to']) delete source.data[key];
    await write('Inbox/notes/recovery-dump.md', matter.stringify(`${source.content.trimEnd()}\n\nA changed version that should be reviewed separately.\n`, { ...source.data, processed: false }));
    const changedVersion = await ingestInbox({
      ...options,
      retryNeedsReview: true,
      generatePlan: async () => ({ decision: 'needs_review', targetPath: null, category: null, title: 'Changed source', summary: '', body: '', rationale: 'New source content must be compiled separately.' }),
    });
    assert.equal(changedVersion.needsReview, 1, 'an edited Inbox note is recompiled after the saved earlier plan finishes');
  });

  it('refuses model-proposed paths that are not among the searched candidate notes', async () => {
    await resetVault();
    const outsidePath = path.join(tempRoot, 'outside.md');
    await write('Work/projects/commute.md', '# Commuting Project\n\nCurrent project.\n');
    await write('Inbox/notes/unsafe-target.md', 'A fact that might match a note.');
    const search = async (_query: string) => ({
      success: true as const,
      query: _query,
      totalMatches: 1,
      truncated: false,
      results: [{
        file: 'Work/projects/commute.md', path: 'Work/projects/commute.md', title: 'Commuting Project',
        description: 'Project details.', tags: [], chunkIndex: 0, score: 0.5, snippet: 'Current project.', matches: ['Current project.'],
      }],
    });
    const result = await ingestInbox(baseOptions({
      search,
      generatePlan: async () => ({
        decision: 'update', targetPath: '../outside.md', category: null,
        title: 'Unsafe', summary: '', body: 'Do not write here.', rationale: 'Invalid target.',
      }),
    }));
    assert.equal(result.needsReview, 1);
    await assert.rejects(fs.access(outsidePath));
    const source = matter(await fs.readFile(path.join(vaultPath, 'Inbox/notes/unsafe-target.md'), 'utf8'));
    assert.notEqual(source.data.processed, true);
  });

  it('marks a note already represented by a retrieved candidate without duplicating wiki text', async () => {
    await resetVault();
    await write('Work/projects/fern.md', '# Fern project\n\nThe project already uses weekly reviews.\n');
    await write('Inbox/notes/weekly-review.md', 'The Fern project already uses weekly reviews.\n');
    const result = await ingestInbox(baseOptions({
      search: async (query) => ({
        success: true,
        query,
        totalMatches: 1,
        truncated: false,
        results: [{
          file: 'Work/projects/fern.md', path: 'Work/projects/fern.md', title: 'Fern project',
          description: 'Project note.', tags: [], chunkIndex: 0, score: 0.4,
          snippet: 'Weekly reviews.', matches: ['Weekly reviews.'],
        }],
      }),
      generatePlan: async () => ({
        decision: 'already_known', targetPath: 'Work/projects/fern.md', category: null,
        title: 'Fern project', summary: '', body: '', rationale: 'The candidate already contains this fact.',
      }),
    }));
    assert.equal(result.alreadyKnown, 1);
    assert.equal(result.created + result.updated, 0);
    assert.equal(await fs.readFile(path.join(vaultPath, 'Work/projects/fern.md'), 'utf8'), '# Fern project\n\nThe project already uses weekly reviews.\n');
  });

  it('archives an already-processed review item directly when the user explicitly asks to archive it', async () => {
    await resetVault();
    await write('index.md', '# Vault Index\n\n[[Inbox/notes/archive-me]]\n');
    await write('Inbox/notes/archive-me.md', '---\nprocessed: true\nprocessed_hash: stale-hash\ningestion_status: needs_review\n---\n\nThis was already handled and should be retained in the archive.\n');
    let compilerCalled = false;
    const result = await ingestInbox(baseOptions({
      retryNeedsReview: true,
      sourcePaths: ['Inbox/notes/archive-me.md'],
      reviewGuidance: { 'Inbox/notes/archive-me.md': 'This was already processed; archive the source only.' },
      generatePlan: async () => {
        compilerCalled = true;
        throw new Error('The model should not be needed to archive this source.');
      },
    }));
    assert.equal(compilerCalled, false);
    assert.equal(result.needsReview, 0);
    assert.match(result.items[0]?.message || '', /Archived at Archive\/Inbox\/notes\/archive-me--/);
    await assert.rejects(fs.access(path.join(vaultPath, 'Inbox/notes/archive-me.md')));
    const archivedPath = await archivedInboxPath('Inbox/notes/archive-me.md');
    assert.match(await fs.readFile(archivedPath, 'utf8'), /already handled and should be retained/);
    assert.match(await fs.readFile(path.join(vaultPath, 'index.md'), 'utf8'), /\[\[Archive\/Inbox\/notes\/archive-me--/);
  });

  it('does not follow a symlinked wiki category when creating a destination', async () => {
    await resetVault();
    const outside = path.join(tempRoot, 'outside-wiki');
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(vaultPath, 'Knowledgebase'), 'dir');
    await write('Inbox/notes/new-topic.md', 'A new knowledgebase topic.');
    const result = await ingestInbox(baseOptions({
      search: emptySearch(),
      generatePlan: async () => ({
        decision: 'create', targetPath: null, category: 'Knowledgebase/concepts',
        title: 'New Topic', summary: '', body: 'A note.', rationale: 'No existing candidate.',
      }),
    }));
    assert.equal(result.failed, 1);
    await assert.rejects(fs.access(path.join(outside, 'concepts', 'new-topic.md')));
  });

  it('runs a heartbeat and writes the dated daily log and append-only operation log', async () => {
    await resetVault();
    const fixed = new Date('2026-09-23T20:00:00.000Z');
    const result = await runHeartbeat({ ...baseOptions(), now: () => fixed, timezone: 'Asia/Kolkata' });
    assert.equal(result.ingestion.scanned, 0);
    const daily = await fs.readFile(path.join(vaultPath, 'daily/2026-09-24.md'), 'utf8');
    assert.match(daily, /Heartbeat/);
    assert.match(daily, /Inbox Markdown files scanned: 0/);
    const log = await fs.readFile(path.join(vaultPath, 'log.md'), 'utf8');
    assert.match(log, /heartbeat scanned 0/);
  });

  it('starts and cleanly stops the scheduled heartbeat task', () => {
    const task = startHeartbeatSchedule({ vaultPath, dbPath, timezone: 'UTC' });
    task.stop();
  });
});
