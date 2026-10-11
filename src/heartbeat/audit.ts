/**
 * audit.ts — Weekly Second Brain Audit Engine (Cole Medin Architecture)
 *
 * Scans the vault for "context rot":
 * 1. Distinguishes State (mutable facts that must be replaced) vs Event (immutable occurrences that append).
 * 2. Audits the always-loaded surface (MEMORY.md, USER.md, SOUL.md) against the freshest evidence in daily logs and notes.
 * 3. Identifies broken [[wikilinks]] and orphan notes.
 * 4. Logs summary to log.md and daily notes (daily/YYYY-MM-DD.md).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { withVaultLock, withFileLock } from '../utils/file-lock.js';

export type ClaimStatus = 'confirmed' | 'contradicted' | 'unsupported';

export type StateClaim = {
  sourceFile: string;
  claim: string;
  category: 'project' | 'status' | 'preference' | 'numeric' | 'general';
  status: ClaimStatus;
  evidence?: string;
  evidenceFile?: string;
};

export type BrokenLink = {
  sourceFile: string;
  target: string;
};

export type AuditReport = {
  auditedAt: string;
  filesScanned: number;
  alwaysLoadedFiles: string[];
  claims: StateClaim[];
  brokenLinks: BrokenLink[];
  orphanNotes: string[];
  summary: {
    totalClaims: number;
    confirmed: number;
    contradicted: number;
    unsupported: number;
    brokenLinks: number;
    orphans: number;
  };
};

function normalizeVaultPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function walkMarkdown(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdown(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(normalizeVaultPath(path.relative(baseDir, fullPath)));
    }
  }
  return files;
}

/**
 * Extracts state-like claims from always-loaded files.
 * Focuses on active projects, status statements, and current preferences.
 */
export function extractStateClaims(fileContent: string, fileName: string): StateClaim[] {
  const claims: StateClaim[] = [];
  const lines = fileContent.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('<!--') || line.startsWith('```')) continue;

    // Bullet points or strong assertions
    const cleanText = line.replace(/^[-*+]\s+/, '').replace(/^\[[ x]\]\s+/i, '').trim();
    if (cleanText.length < 8) continue;

    // Check for State patterns (current values, active items, preferences, statuses)
    const isState = /\b(active|currently|current|status|using|lives at|working on|deadline|rate|prefer|prefers|lead|owner)\b/i.test(cleanText);
    const isEvent = /\b(on \d{4}-\d{2}-\d{2}|yesterday|launched on|decided on|discussed on|paid)\b/i.test(cleanText);

    if (isState && !isEvent) {
      let category: StateClaim['category'] = 'general';
      if (/project/i.test(cleanText)) category = 'project';
      else if (/status|active|on hold|paused/i.test(cleanText)) category = 'status';
      else if (/prefer|communication|working style/i.test(cleanText)) category = 'preference';
      else if (/\$|\d+\s*(?:usd|inr|hr|hours|days|%)/i.test(cleanText)) category = 'numeric';

      claims.push({
        sourceFile: fileName,
        claim: cleanText,
        category,
        status: 'unsupported', // default until validated
      });
    }
  }

  return claims;
}

/**
 * Finds all [[wikilinks]] in a markdown string.
 */
export function extractWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  const targets: string[] = [];
  for (const match of matches) {
    if (match[1]) targets.push(match[1].trim());
  }
  return targets;
}

/**
 * Audits the vault and produces an AuditReport.
 */
export async function runSecondBrainAudit(vaultDir = process.env.VAULT_PATH || './vault'): Promise<AuditReport> {
  const root = path.resolve(vaultDir);
  return withVaultLock(root, async () => {
    const allFiles = await walkMarkdown(root);
    const fileSet = new Set(allFiles.map((f) => f.replace(/\.md$/i, '').toLowerCase()));
    const exactFileSet = new Set(allFiles);

    const alwaysLoaded = ['MEMORY.md', 'USER.md', 'SOUL.md'].filter((f) => exactFileSet.has(f));
    const allClaims: StateClaim[] = [];

    // 1. Audit always-loaded files for state claims
    for (const fileName of alwaysLoaded) {
      try {
        const content = await fs.readFile(path.join(root, fileName), 'utf8');
        allClaims.push(...extractStateClaims(content, fileName));
      } catch {
        // file missing or unreadable
      }
    }

    // 2. Read all files into memory for cross-validation and link analysis
    const fileContents = new Map<string, string>();
    const inboundLinkCount = new Map<string, number>();
    const outboundLinkCount = new Map<string, number>();
    const brokenLinks: BrokenLink[] = [];

    for (const file of allFiles) {
      inboundLinkCount.set(file, 0);
      outboundLinkCount.set(file, 0);
      try {
        const text = await fs.readFile(path.join(root, file), 'utf8');
        fileContents.set(file, text);
      } catch {
        // skip
      }
    }

    // 3. Wikilink validation
    for (const [sourceFile, content] of fileContents.entries()) {
      const links = extractWikilinks(content);
      outboundLinkCount.set(sourceFile, links.length);

      for (const target of links) {
        const normalizedTarget = target.replace(/\.md$/i, '').toLowerCase();
        // Check if target exists directly or as path segment
        const exists = fileSet.has(normalizedTarget) ||
          allFiles.some((f) => path.basename(f, '.md').toLowerCase() === normalizedTarget);

        if (exists) {
          // Increment inbound
          for (const f of allFiles) {
            if (f.replace(/\.md$/i, '').toLowerCase() === normalizedTarget ||
                path.basename(f, '.md').toLowerCase() === normalizedTarget) {
              inboundLinkCount.set(f, (inboundLinkCount.get(f) ?? 0) + 1);
            }
          }
        } else {
          brokenLinks.push({ sourceFile, target });
        }
      }
    }

    // 4. Validate Claims against freshest notes and logs
    // Look for contradictions in daily logs and recent notes
    for (const claimObj of allClaims) {
      const claimLower = claimObj.claim.toLowerCase();
      // Extract keywords (words > 4 chars)
      const keywords = claimLower.match(/\b[a-z0-9_-]{4,}\b/g) ?? [];
      let foundEvidence = false;
      let contradicted = false;

      // Check daily logs and Work notes
      for (const [file, text] of fileContents.entries()) {
        if (file === claimObj.sourceFile) continue;
        const textLower = text.toLowerCase();

        // Check for contradiction keywords
        const mentionsSubject = keywords.some((kw) => textLower.includes(kw));
        if (mentionsSubject) {
          foundEvidence = true;
          claimObj.evidenceFile = file;

          // Detect contradiction markers: cancelled, paused, moved, changed, deprecated, finished
          if (/\b(cancelled|canceled|on hold|paused|deprecated|dropped|abandoned|no longer|stopped)\b/i.test(textLower) &&
              /\b(active|lead|working on)\b/i.test(claimLower)) {
            contradicted = true;
            claimObj.evidence = `Found opposing status in ${file}`;
            break;
          }
        }
      }

      if (contradicted) {
        claimObj.status = 'contradicted';
      } else if (foundEvidence) {
        claimObj.status = 'confirmed';
      } else {
        claimObj.status = 'unsupported';
      }
    }

    // 5. Detect Orphan Notes
    const orphanNotes = allFiles.filter((f) => {
      // Exclude system files, daily logs, inbox, index, log
      if (/^(SOUL|USER|MEMORY|BOOTSTRAP|HEARTBEAT|index|log)\.md$/i.test(f)) return false;
      if (f.startsWith('daily/') || f.startsWith('Inbox/')) return false;
      return (inboundLinkCount.get(f) ?? 0) === 0 && (outboundLinkCount.get(f) ?? 0) === 0;
    });

    const report: AuditReport = {
      auditedAt: new Date().toISOString(),
      filesScanned: allFiles.length,
      alwaysLoadedFiles: alwaysLoaded,
      claims: allClaims,
      brokenLinks,
      orphanNotes,
      summary: {
        totalClaims: allClaims.length,
        confirmed: allClaims.filter((c) => c.status === 'confirmed').length,
        contradicted: allClaims.filter((c) => c.status === 'contradicted').length,
        unsupported: allClaims.filter((c) => c.status === 'unsupported').length,
        brokenLinks: brokenLinks.length,
        orphans: orphanNotes.length,
      },
    };

    // 6. Record findings to log.md and daily notes
    await recordAudit(root, report);

    return report;
  });
}

async function recordAudit(root: string, report: AuditReport): Promise<void> {
  const timestamp = new Date();
  const dateStr = timestamp.toISOString().split('T')[0];
  const timeStr = timestamp.toTimeString().split(' ')[0].slice(0, 5);

  const logEntry = `- ${dateStr} ${timeStr}: [Second Brain Audit] Scanned ${report.filesScanned} notes; claims: ${report.summary.totalClaims} (${report.summary.confirmed} confirmed, ${report.summary.contradicted} contradicted, ${report.summary.unsupported} unsupported); ${report.summary.brokenLinks} broken links; ${report.summary.orphans} orphan notes.\n`;

  const logFile = path.join(root, 'log.md');
  await withFileLock(logFile, async () => {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.appendFile(logFile, logEntry, 'utf8');
  });

  // Daily note entry
  const dailyFile = path.join(root, 'daily', `${dateStr}.md`);
  const dailySummary = [
    '',
    `### Second Brain Audit (${timeStr})`,
    '',
    `- **Files Scanned:** ${report.filesScanned}`,
    `- **State Claims:** ${report.summary.totalClaims} total (${report.summary.confirmed} confirmed, ${report.summary.contradicted} contradicted, ${report.summary.unsupported} unsupported)`,
    `- **Broken Wikilinks:** ${report.summary.brokenLinks}`,
    `- **Orphan Notes:** ${report.summary.orphans}`,
    ...(report.summary.contradicted > 0 ? [
      '',
      '**Contradicted Claims (Context Rot):**',
      ...report.claims
        .filter((c) => c.status === 'contradicted')
        .map((c) => `  - \`${c.sourceFile}\`: "${c.claim}" → ${c.evidence ?? 'Contradicted by newer notes'}`),
    ] : []),
    ...(report.brokenLinks.length > 0 ? [
      '',
      '**Broken Links:**',
      ...report.brokenLinks.slice(0, 5).map((l) => `  - \`${l.sourceFile}\` → \`[[${l.target}]]\``),
    ] : []),
    '',
  ].join('\n');

  await withFileLock(dailyFile, async () => {
    await fs.mkdir(path.dirname(dailyFile), { recursive: true });
    await fs.appendFile(dailyFile, dailySummary, 'utf8');
  });
}
