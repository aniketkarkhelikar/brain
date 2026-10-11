/**
 * scratchpad.ts — Working Memory Scratchpad & Memory Pointer Pattern
 *
 * Implements the industry-standard "Context Window is RAM, Disk is Storage" pattern.
 * Large tool outputs (e.g. web pages, large catalogs, raw notes >2,500 chars) are
 * offloaded to temporary scratch files in `state/scratch/`, leaving only a compact
 * pointer and preview in active model context.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_INLINE_CHARS = 2_500;
export const DEFAULT_PREVIEW_CHARS = 500;

export interface ScratchpadRef {
  isOffloaded: boolean;
  scratchPath: string;
  preview: string;
  totalChars: number;
}

export function getScratchDir(): string {
  return path.resolve(process.env.SCRATCH_PATH || './state/scratch');
}

/**
 * Offloads content to a scratchpad file if it exceeds MAX_INLINE_CHARS.
 */
export async function offloadToScratchpad(
  toolName: string,
  rawContent: string,
  options?: { previewChars?: number; maxInlineChars?: number }
): Promise<ScratchpadRef> {
  const maxChars = options?.maxInlineChars ?? MAX_INLINE_CHARS;
  const totalChars = rawContent.length;

  if (totalChars <= maxChars) {
    return {
      isOffloaded: false,
      scratchPath: '',
      preview: rawContent,
      totalChars,
    };
  }

  const scratchDir = getScratchDir();
  await fs.mkdir(scratchDir, { recursive: true, mode: 0o700 });

  const hash = createHash('sha256').update(rawContent).digest('hex').slice(0, 10);
  const cleanToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${cleanToolName}_${Date.now()}_${hash}.md`;
  const fullPath = path.join(scratchDir, fileName);

  await fs.writeFile(fullPath, rawContent, { encoding: 'utf8', mode: 0o600 });

  const previewLimit = options?.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const preview = rawContent.slice(0, previewLimit).trim();
  const relPath = path.relative(process.cwd(), fullPath).replaceAll('\\', '/');

  return {
    isOffloaded: true,
    scratchPath: relPath,
    preview,
    totalChars,
  };
}

/**
 * Reads content from an offloaded scratchpad file with path sanitization.
 */
export async function readScratchpad(
  scratchPath: string,
  options?: { startChar?: number; maxChars?: number }
): Promise<{ success: boolean; content?: string; totalChars?: number; error?: string }> {
  const normalized = scratchPath.replaceAll('\\', '/').trim();
  const scratchDir = getScratchDir();
  const resolved = path.resolve(process.cwd(), normalized);

  const relative = path.relative(scratchDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      success: false,
      error: 'Invalid scratchpad path: path traverses outside the scratchpad directory.',
    };
  }

  try {
    const raw = await fs.readFile(resolved, 'utf8');
    const start = options?.startChar ?? 0;
    const max = options?.maxChars ?? 10_000;
    const slice = raw.slice(start, start + max);

    return {
      success: true,
      content: slice,
      totalChars: raw.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Could not read scratchpad file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Clears scratchpad files older than maxAgeHours (default 24h).
 */
export async function clearOldScratchpads(maxAgeHours = 24): Promise<number> {
  const scratchDir = getScratchDir();
  let deletedCount = 0;

  try {
    const entries = await fs.readdir(scratchDir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.md')) {
        const full = path.join(scratchDir, ent.name);
        try {
          const stat = await fs.stat(full);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.unlink(full);
            deletedCount++;
          }
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Scratch directory does not exist yet
  }

  return deletedCount;
}
