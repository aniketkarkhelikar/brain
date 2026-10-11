import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runVaultLint } from './audit.js';

let tempDir = '';
let vaultDir = '';

describe('vault lint report', () => {
  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-audit-'));
    vaultDir = path.join(tempDir, 'vault');
    await fs.mkdir(path.join(vaultDir, 'Work', 'projects'), { recursive: true });
    await fs.mkdir(path.join(vaultDir, 'Knowledgebase', 'concepts'), { recursive: true });
    await fs.writeFile(path.join(vaultDir, 'index.md'), [
      '# Vault Index',
      '[[missing-note]] [[missing-note]]',
      '[[Launch]] [[Launch]]',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(vaultDir, 'Work', 'projects', 'launch.md'), '# Launch\n');
    await fs.writeFile(path.join(vaultDir, 'Knowledgebase', 'concepts', 'launch.md'), '# Launch concept\n');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports each repeated broken or ambiguous target once per source note', async () => {
    const report = await runVaultLint(vaultDir, path.join(tempDir, 'state', 'vault-lint.json'));
    const indexFindings = report.findings.filter((finding) => finding.file === 'index.md');
    assert.equal(indexFindings.filter((finding) => finding.kind === 'broken-link').length, 1);
    assert.equal(indexFindings.filter((finding) => finding.kind === 'ambiguous-link').length, 1);
    assert.equal(report.summary.errors, 1);
  });
});
