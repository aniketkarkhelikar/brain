import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractStateClaims, extractWikilinks, runSecondBrainAudit } from './audit.js';

test('second brain audit engine', async (t) => {
  const temporaryVault = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-audit-test-'));

  t.after(async () => {
    await fs.rm(temporaryVault, { recursive: true, force: true });
  });

  await t.test('distinguishes mutable state from immutable events', () => {
    const memoryContent = `
# Current State
- Active project: FoodTrace supply chain tracker
- Currently using Qwen 2.5 14b model
- Hourly rate: $150/hr

## Event Log
- launched on 2026-05-01
- decided on 2026-06-15 to drop MongoDB
- paid invoice #102 on 2026-07-01
`;
    const claims = extractStateClaims(memoryContent, 'MEMORY.md');
    assert.equal(claims.length, 3);
    assert.equal(claims[0].category, 'project');
    assert.match(claims[0].claim, /FoodTrace/);
    assert.match(claims[1].claim, /Qwen/);
    assert.equal(claims[2].category, 'numeric');
  });

  await t.test('extracts wikilinks accurately', () => {
    const text = 'Check out [[Knowledgebase/concepts/RAG]] and [[Work/projects/FoodTrace|FoodTrace Project]].';
    const links = extractWikilinks(text);
    assert.deepEqual(links, ['Knowledgebase/concepts/RAG', 'Work/projects/FoodTrace']);
  });

  await t.test('identifies broken links, orphan notes, and logs audit outcome', async () => {
    await fs.mkdir(path.join(temporaryVault, 'Work', 'projects'), { recursive: true });
    await fs.mkdir(path.join(temporaryVault, 'Knowledgebase', 'concepts'), { recursive: true });

    // 1. Always loaded file with an active project claim
    await fs.writeFile(
      path.join(temporaryVault, 'MEMORY.md'),
      '# Memory\n- Active project: Moonshot initiative\n- [[Knowledgebase/concepts/RAG]]\n- [[MissingNote]]\n',
    );

    // 2. Note referencing RAG
    await fs.writeFile(
      path.join(temporaryVault, 'Knowledgebase', 'concepts', 'RAG.md'),
      '# RAG\nRetrieval Augmented Generation.\n',
    );

    // 3. Note with contradictory evidence (Moonshot cancelled)
    await fs.writeFile(
      path.join(temporaryVault, 'Work', 'projects', 'moonshot-log.md'),
      '# Moonshot Log\nMoonshot initiative is cancelled due to budget cuts.\n',
    );

    // 4. An orphan note
    await fs.writeFile(
      path.join(temporaryVault, 'Knowledgebase', 'concepts', 'orphan.md'),
      '# Orphan Note\nNo incoming or outgoing links.\n',
    );

    const report = await runSecondBrainAudit(temporaryVault);

    assert.equal(report.filesScanned, 4);
    assert.equal(report.summary.brokenLinks, 1);
    assert.equal(report.brokenLinks[0].target, 'MissingNote');
    assert.equal(report.summary.orphans, 2);
    assert.ok(report.orphanNotes.includes('Knowledgebase/concepts/orphan.md'));
    assert.ok(report.orphanNotes.includes('Work/projects/moonshot-log.md'));

    // Contradiction detection
    const contradictedClaim = report.claims.find((c) => c.status === 'contradicted');
    assert.ok(contradictedClaim, 'Should detect contradicted Moonshot initiative');
    assert.match(contradictedClaim.claim, /Moonshot/);

    // Verify audit logs were written
    const logContent = await fs.readFile(path.join(temporaryVault, 'log.md'), 'utf8');
    assert.match(logContent, /Second Brain Audit/);
    assert.match(logContent, /Scanned 4 notes/i);

    const today = new Date().toISOString().split('T')[0];
    const dailyContent = await fs.readFile(path.join(temporaryVault, 'daily', `${today}.md`), 'utf8');
    assert.match(dailyContent, /Second Brain Audit/);
    assert.match(dailyContent, /\*\*Broken Wikilinks:\*\* 1/);
  });
});
