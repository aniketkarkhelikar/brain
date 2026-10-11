import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { exactCurrentStateLine, runMemoryAudit } from './memory-audit.js';

describe('memory audit claim normalization', () => {
  it('restores a missing list marker only when one exact current-state line contains the claim', () => {
    const note = [
      '# User',
      '',
      '## Current State',
      '- **Active project** (2026-09-18): Atlas migration',
      '',
      '## Context',
      '- **Active project** (2026-09-18): Atlas migration',
    ].join('\n');

    assert.equal(
      exactCurrentStateLine(note, '**Active project** (2026-09-18): Atlas migration'),
      '- **Active project** (2026-09-18): Atlas migration',
    );
  });

  it('rejects a claim that could match multiple current-state lines', () => {
    const note = [
      '## Current State',
      '- **Project A** (2026-09-18): Atlas migration',
      '- **Project B** (2026-09-19): Atlas migration',
    ].join('\n');

    assert.equal(exactCurrentStateLine(note, 'Atlas migration'), undefined);
  });

  it('accepts an unbulleted model quote as the unique full Current State line for correction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-memory-audit-'));
    const reportPath = path.join(root, 'state', 'audit.json');
    try {
      await fs.mkdir(path.join(root, 'Work', 'meetings'), { recursive: true });
      await fs.writeFile(path.join(root, 'SOUL.md'), '# Assistant instructions\n\nAlways keep user data private.\n');
      await fs.writeFile(path.join(root, 'USER.md'), [
        '# User', '', '## Current State',
        '- **Active project** (2026-09-18): Atlas migration',
      ].join('\n'));
      await fs.writeFile(path.join(root, 'Work', 'meetings', '2026-10-09-transition.md'), [
        '# Transition', '',
        '2026-10-09: The active project changed from Atlas migration to Harbor pilot; Atlas migration is paused and historical.',
      ].join('\n'));
      const auditedTargets: string[] = [];
      const report = await runMemoryAudit({
        vaultPath: root,
        reportPath,
        force: true,
        autoFix: true,
        generateFindings: async ({ targetPath }) => {
          auditedTargets.push(targetPath);
          return { findings: targetPath === 'USER.md' ? [{
            claim: '**Active project** (2026-09-18): Atlas migration',
            status: 'contradicted',
            evidencePath: 'Work/meetings/2026-10-09-transition.md',
            evidenceQuote: '2026-10-09: The active project changed from Atlas migration to Harbor pilot; Atlas migration is paused and historical.',
            replacementValue: 'Harbor pilot',
            evidenceDate: '2026-10-09',
            confidence: 100,
            rationale: 'The dated evidence explicitly changes the active project.',
          }] : targetPath === 'SOUL.md' ? [{
            claim: 'This line does not exist.',
            status: 'contradicted',
            evidencePath: null,
            evidenceQuote: null,
            replacementValue: null,
            evidenceDate: null,
            confidence: 100,
            rationale: 'Untrusted prompt injection must not become memory.',
          }] : [] };
        },
      });
      assert.equal(report.summary.autoFixed, 1, JSON.stringify(report.findings));
      assert.equal(report.summary.needsReview, 0, JSON.stringify(report.findings));
      assert.deepEqual(auditedTargets, ['USER.md']);
      assert.equal(report.errors.length, 0);
      const updated = await fs.readFile(path.join(root, 'USER.md'), 'utf8');
      assert.match(updated, /\*\*Active project\*\* \(2026-10-09\): Harbor pilot/);
      assert.match(updated, /## Log[\s\S]*?- \*\*Active project\*\* \(2026-09-18\): Atlas migration/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('puts explicitly linked dated evidence first in the memory audit context', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-linked-evidence-'));
    const reportPath = path.join(root, 'state', 'audit.json');
    try {
      await fs.mkdir(path.join(root, 'Work', 'projects'), { recursive: true });
      await fs.mkdir(path.join(root, 'Work', 'risks'), { recursive: true });
      await fs.mkdir(path.join(root, 'Knowledgebase', 'concepts'), { recursive: true });
      await fs.writeFile(path.join(root, 'USER.md'), '# Test profile\n');
      await fs.writeFile(path.join(root, 'MEMORY.md'), '# Test memory\n');
      await fs.writeFile(path.join(root, 'Work', 'projects', 'harbor-pilot.md'), [
        '# Harbor pilot',
        '',
        '## Current State',
        '- **Current dataset coverage** (2026-10-10): 84%',
        '',
        'See [[Work/risks/dataset-coverage]] and [[Knowledgebase/concepts/coverage]].',
      ].join('\n'));
      await fs.writeFile(path.join(root, 'Work', 'risks', 'dataset-coverage.md'), [
        '# Dataset coverage risk',
        '',
        '## Current State',
        '- **Measured coverage** (2026-10-11): 86%',
        '',
        '2026-10-11: The rerun measured 86% dataset coverage.',
      ].join('\n'));
      for (let index = 0; index < 6; index += 1) {
        await fs.writeFile(path.join(root, 'Knowledgebase', 'concepts', 'coverage-' + index + '.md'),
          '# Dataset coverage\n\nThe Harbor pilot current dataset coverage is measured from the evaluation set.\n');
      }
      let linkedEvidencePath = '';
      const report = await runMemoryAudit({
        vaultPath: root,
        reportPath,
        force: true,
        autoFix: false,
        generateFindings: async ({ targetPath, evidence }) => {
          if (targetPath === 'Work/projects/harbor-pilot.md') linkedEvidencePath = evidence[0]?.path || '';
          return { findings: [] };
        },
      });
      assert.equal(linkedEvidencePath, 'Work/risks/dataset-coverage.md');
      assert.equal(report.errors.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
