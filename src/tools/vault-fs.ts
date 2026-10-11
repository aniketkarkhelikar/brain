import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { withFileLock } from '../utils/file-lock.js';

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultPathError';
  }
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function vaultPath(): string {
  return path.resolve(process.cwd(), process.env.VAULT_PATH || './vault');
}

function relativeSegments(input: string, allowRoot = false): string[] {
  if (input.includes('\0')) {
    throw new VaultPathError('Paths cannot contain a null character.');
  }

  const normalized = input.replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(input) ||
    /^[a-zA-Z]:/.test(input)
  ) {
    throw new VaultPathError('Use a relative path inside the vault.');
  }

  if (normalized === '' || normalized === '.') {
    if (allowRoot) return [];
    throw new VaultPathError('A file path inside the vault is required.');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new VaultPathError('Paths cannot contain empty, ".", or ".." segments.');
  }

  return segments;
}

async function getVaultRoot(): Promise<string> {
  const root = await fs.realpath(vaultPath());
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) throw new VaultPathError('The configured vault path is not a directory.');
  return root;
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new VaultPathError('The requested path is outside the vault.');
  }
}

async function inspectExistingPath(
  root: string,
  segments: string[],
  allowRoot: boolean,
): Promise<string> {
  if (segments.length === 0) {
    if (!allowRoot) throw new VaultPathError('A path inside the vault is required.');
    return root;
  }

  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink()) {
      throw new VaultPathError('Symbolic links are not allowed in vault paths.');
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new VaultPathError('A parent path component is not a directory.');
    }
  }

  assertContained(root, current);
  return current;
}

async function existingFile(filePath: string): Promise<string> {
  const root = await getVaultRoot();
  const segments = relativeSegments(filePath);
  const fullPath = await inspectExistingPath(root, segments, false);
  const stats = await fs.stat(fullPath);
  if (!stats.isFile()) throw new VaultPathError('The requested vault path is not a file.');
  return fullPath;
}

export async function readVaultFile(filePath: string): Promise<string> {
  return fs.readFile(await existingFile(filePath), 'utf8');
}

export async function readVaultFileIfSmall(filePath: string, maxBytes: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be a positive safe integer.');
  const fullPath = await existingFile(filePath);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(fullPath, fsConstants.O_RDONLY | noFollow);
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return undefined;
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function safeWritePath(filePath: string): Promise<string> {
  const root = await getVaultRoot();
  const segments = relativeSegments(filePath);
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    const next = path.join(current, segment);
    try {
      await fs.mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const stats = await fs.lstat(next);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new VaultPathError('A parent path component is not a safe directory.');
    }
    const realNext = await fs.realpath(next);
    assertContained(root, realNext);
    current = realNext;
  }

  const fullPath = path.join(current, segments.at(-1)!);
  assertContained(root, fullPath);
  try {
    const stats = await fs.lstat(fullPath);
    if (stats.isSymbolicLink()) throw new VaultPathError('Symbolic links are not allowed in vault paths.');
    if (!stats.isFile()) throw new VaultPathError('The requested vault path is not a file.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return fullPath;
}

export async function writeVaultFile(
  filePath: string,
  content: string,
  mode: 'write' | 'append',
): Promise<number> {
  const fullPath = await safeWritePath(filePath);
  let text = content;

  if (mode === 'append' && content.length > 0) {
    try {
      const existing = await fs.readFile(fullPath, 'utf8');
      if (existing.length > 0 && !existing.endsWith('\n')) text = `\n${text}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return withFileLock(fullPath, async () => {
    const flags = mode === 'append'
      ? fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT
      : fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_CREAT;
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const handle = await fs.open(fullPath, flags | noFollow, 0o600);
    try {
      await handle.writeFile(text, 'utf8');
    } finally {
      await handle.close();
    }
    return Buffer.byteLength(text, 'utf8');
  });
}

const PROTECTED_ROOT_FILES = new Set([
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'index.md',
  'log.md',
]);

function assertNotProtected(filePath: string, operation: string): void {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (PROTECTED_ROOT_FILES.has(normalized)) {
    throw new VaultPathError(`Cannot ${operation} protected system vault file: "${normalized}".`);
  }
}

export async function deleteVaultFile(filePath: string): Promise<void> {
  assertNotProtected(filePath, 'delete');
  const fullPath = await existingFile(filePath);
  await withFileLock(fullPath, async () => {
    await fs.unlink(fullPath);
  });
}

export async function moveVaultFile(sourcePath: string, destinationPath: string): Promise<void> {
  assertNotProtected(sourcePath, 'move');
  assertNotProtected(destinationPath, 'overwrite with move');
  const fullSource = await existingFile(sourcePath);
  const fullDest = await safeWritePath(destinationPath);
  await withFileLock(fullSource, async () => {
    await withFileLock(fullDest, async () => {
      await fs.rename(fullSource, fullDest);
    });
  });
}

export async function patchVaultFile(
  filePath: string,
  search: string,
  replace: string,
  allowMultiple = false,
): Promise<{ replacements: number }> {
  if (!search) throw new VaultPathError('Search target cannot be empty.');
  const fullPath = await existingFile(filePath);
  return withFileLock(fullPath, async () => {
    const content = await fs.readFile(fullPath, 'utf8');
    if (!content.includes(search)) {
      throw new VaultPathError(`Search target not found in "${filePath}".`);
    }

    let replacements = 0;
    let newContent: string;
    if (allowMultiple) {
      newContent = content.split(search).join(replace);
      replacements = content.split(search).length - 1;
    } else {
      const firstIndex = content.indexOf(search);
      const secondIndex = content.indexOf(search, firstIndex + search.length);
      if (secondIndex !== -1) {
        throw new VaultPathError(
          `Multiple matches found for patch target in "${filePath}". Provide more surrounding context or set allowMultiple: true.`,
        );
      }
      newContent = content.slice(0, firstIndex) + replace + content.slice(firstIndex + search.length);
      replacements = 1;
    }

    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const handle = await fs.open(fullPath, fsConstants.O_WRONLY | fsConstants.O_TRUNC | noFollow, 0o600);
    try {
      await handle.writeFile(newContent, 'utf8');
    } finally {
      await handle.close();
    }
    return { replacements };
  });
}

export async function metaVaultFile(
  filePath: string,
  updates?: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> }> {
  const fullPath = await existingFile(filePath);
  return withFileLock(fullPath, async () => {
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = matter(raw);

    if (updates && Object.keys(updates).length > 0) {
      const mergedData = { ...parsed.data };
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined) {
          delete mergedData[key];
        } else {
          mergedData[key] = value;
        }
      }
      const updatedMarkdown = matter.stringify(parsed.content, mergedData);
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      const handle = await fs.open(fullPath, fsConstants.O_WRONLY | fsConstants.O_TRUNC | noFollow, 0o600);
      try {
        await handle.writeFile(updatedMarkdown, 'utf8');
      } finally {
        await handle.close();
      }
      return { data: mergedData };
    }

    return { data: parsed.data };
  });
}

export async function listVaultDirectory(dirPath: string): Promise<Array<{ name: string; type: 'directory' | 'file' }>> {
  const root = await getVaultRoot();
  const segments = relativeSegments(dirPath, true);
  const fullPath = await inspectExistingPath(root, segments, true);
  const stats = await fs.stat(fullPath);
  if (!stats.isDirectory()) throw new VaultPathError('The requested vault path is not a directory.');

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' as const : 'file' as const }))
    .sort((a, b) => compareNames(a.name, b.name));
}

async function collectMarkdownFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => compareNames(a.name, b.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath, relative));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(relative);
    }
  }

  return files;
}

export async function searchVaultFiles(
  query: string,
  maxResults: number,
): Promise<{ totalMatches: number; results: Array<{ file: string; matches: string[] }> }> {
  const root = await getVaultRoot();
  const markdownFiles = await collectMarkdownFiles(root);
  const needle = query.toLowerCase();
  const results: Array<{ file: string; matches: string[] }> = [];
  let totalMatches = 0;

  for (const file of markdownFiles) {
    const content = await fs.readFile(await existingFile(file), 'utf8');
    const lines = content.split(/\r?\n/);
    const matches = lines
      .filter((line) => line.toLowerCase().includes(needle))
      .slice(0, 3)
      .map((line) => {
        const trimmed = line.trim();
        return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
      });

    if (matches.length === 0) continue;
    totalMatches += 1;
    if (results.length < maxResults) results.push({ file, matches });
  }

  return { totalMatches, results };
}

export function toolError(operation: string, target: string, error: unknown): string {
  if (error instanceof VaultPathError) return error.message;

  const code = (error as NodeJS.ErrnoException | null)?.code;
  const reason = code === 'ENOENT'
    ? 'the path does not exist'
    : code === 'EACCES' || code === 'EPERM'
      ? 'permission was denied'
      : code === 'ENOSPC'
        ? 'there is not enough disk space'
        : 'the filesystem operation failed';
  return `${operation} failed for "${target}": ${reason}.`;
}
