/** Deterministic vault linting. Findings are evidence-backed and safe to rerun. */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

export type VaultLintFinding = {
  id: string;
  severity: 'error' | 'warning';
  kind: 'broken-link' | 'ambiguous-link' | 'empty-note' | 'orphan-note' | 'processed-inbox-item';
  file: string;
  detail: string;
};

export type VaultLintReport = {
  auditedAt: string;
  vaultPath: string;
  filesScanned: number;
  summary: { errors: number; warnings: number };
  findings: VaultLintFinding[];
};

type Note = { path: string; content: string; links: string[] };

function stableId(kind: VaultLintFinding['kind'], file: string, detail: string): string {
  return createHash('sha256').update(`${kind}\n${file}\n${detail}`).digest('hex').slice(0, 16);
}

function addFinding(
  findings: VaultLintFinding[],
  severity: VaultLintFinding['severity'],
  kind: VaultLintFinding['kind'],
  file: string,
  detail: string,
): void {
  findings.push({ id: stableId(kind, file, detail), severity, kind, file, detail });
}

async function walkMarkdown(root: string, directory = root): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(root, absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return files;
}

function linkTargets(content: string): string[] {
  const prose = content
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?(?:#[^\]]*)?\]\]/g)]
    .map((match) => match[1].trim().replaceAll('\\', '/').replace(/\.md$/i, ''))
    .filter(Boolean);
}

function isExpectedStandalone(file: string): boolean {
  const normalized = file.toLowerCase();
  return /^(soul|user|memory|heartbeat|bootstrap|index|log)\.md$/.test(normalized)
    || normalized.startsWith('inbox/')
    || normalized.startsWith('archive/')
    || normalized.startsWith('daily/');
}

function findingOrder(left: VaultLintFinding, right: VaultLintFinding): number {
  const severity = (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1);
  return severity || left.file.localeCompare(right.file) || left.kind.localeCompare(right.kind);
}

export async function runVaultLint(
  vaultDir = process.env.VAULT_PATH || './vault',
  reportPath = process.env.VAULT_LINT_REPORT || './state/vault-lint.json',
): Promise<VaultLintReport> {
  const root = await fs.realpath(path.resolve(vaultDir));
  const files = await walkMarkdown(root);
  const notes: Note[] = [];
  const findings: VaultLintFinding[] = [];

  for (const file of files) {
    const content = await fs.readFile(path.join(root, ...file.split('/')), 'utf8');
    if (!content.trim()) {
      addFinding(findings, 'error', 'empty-note', file, 'Markdown file is empty.');
      continue;
    }
    const parsed = matter(content);
    if (file.toLowerCase().startsWith('inbox/') && parsed.data.processed === true) {
      addFinding(findings, 'warning', 'processed-inbox-item', file, 'This source is marked processed but is still in Inbox; run the Inbox compiler to archive it.');
    }
    notes.push({ path: file, content: parsed.content, links: linkTargets(parsed.content) });
  }

  const byPath = new Map<string, string>();
  const byBaseName = new Map<string, string[]>();
  const inbound = new Map<string, number>();
  for (const note of notes) {
    const normalizedPath = note.path.replace(/\.md$/i, '').toLowerCase();
    byPath.set(normalizedPath, note.path);
    const baseName = path.posix.basename(normalizedPath);
    byBaseName.set(baseName, [...(byBaseName.get(baseName) || []), note.path]);
    inbound.set(note.path, 0);
  }

  for (const note of notes) {
    for (const target of note.links) {
      const normalizedTarget = target.replace(/^\.\//, '').toLowerCase();
      const relativeTarget = target.startsWith('../') || target.startsWith('./')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(note.path), target)).toLowerCase()
        : normalizedTarget;
      const exact = byPath.get(normalizedTarget) || byPath.get(relativeTarget);
      if (exact) {
        inbound.set(exact, (inbound.get(exact) || 0) + 1);
        continue;
      }
      const matches = normalizedTarget.includes('/') || relativeTarget.startsWith('../')
        ? []
        : byBaseName.get(path.posix.basename(normalizedTarget)) || [];
      if (matches.length === 1) {
        inbound.set(matches[0], (inbound.get(matches[0]) || 0) + 1);
      } else if (matches.length > 1) {
        addFinding(findings, 'warning', 'ambiguous-link', note.path, `[[${target}]] matches multiple notes: ${matches.join(', ')}.`);
      } else {
        addFinding(findings, 'error', 'broken-link', note.path, `[[${target}]] does not resolve to a Markdown note.`);
      }
    }
  }

  for (const note of notes) {
    if (!isExpectedStandalone(note.path) && (inbound.get(note.path) || 0) === 0 && note.links.length === 0) {
      addFinding(findings, 'warning', 'orphan-note', note.path, 'No inbound or outbound wikilinks. Review whether this note belongs in a connected topic or project.');
    }
  }

  const uniqueFindings = [...new Map(findings.map((finding) => [finding.id, finding])).values()];
  uniqueFindings.sort(findingOrder);
  const report: VaultLintReport = {
    auditedAt: new Date().toISOString(),
    vaultPath: root,
    filesScanned: files.length,
    summary: {
      errors: uniqueFindings.filter((finding) => finding.severity === 'error').length,
      warnings: uniqueFindings.filter((finding) => finding.severity === 'warning').length,
    },
    findings: uniqueFindings,
  };

  const absoluteReportPath = path.resolve(reportPath);
  await fs.mkdir(path.dirname(absoluteReportPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${absoluteReportPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, absoluteReportPath);
  return report;
}

export async function readLatestVaultLint(
  reportPath = process.env.VAULT_LINT_REPORT || './state/vault-lint.json',
): Promise<VaultLintReport | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.resolve(reportPath), 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    const report = value as Partial<VaultLintReport>;
    if (
      typeof report.auditedAt !== 'string' || typeof report.vaultPath !== 'string'
      || typeof report.filesScanned !== 'number' || !Array.isArray(report.findings)
      || !report.summary || typeof report.summary.errors !== 'number' || typeof report.summary.warnings !== 'number'
    ) return undefined;
    return report as VaultLintReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function main(): Promise<void> {
  const report = await runVaultLint();
  console.log(`Vault lint complete: scanned ${report.filesScanned} notes; ${report.summary.errors} errors; ${report.summary.warnings} warnings.`);
  for (const finding of report.findings) console.log(`- ${finding.severity}: ${finding.file}: ${finding.detail}`);
  if (report.summary.errors) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Vault lint failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
