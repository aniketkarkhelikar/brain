/** Watches local Markdown vaults and coalesces editor saves into one maintenance pass. */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';

export type VaultWatchChange = { event: 'add' | 'change' | 'unlink'; path: string };
export type VaultWatcherOptions = {
  vaultPath: string;
  debounceMs?: number;
  onBatch: (changes: VaultWatchChange[]) => Promise<void>;
  onError?: (error: Error) => void;
  onReady?: () => void;
};

export function startVaultWatcher(options: VaultWatcherOptions): FSWatcher {
  const root = path.resolve(options.vaultPath);
  const debounceMs = options.debounceMs ?? 800;
  const pending = new Map<string, VaultWatchChange['event']>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    atomic: 200,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    ignored: (observedPath, stats) => {
      const absolute = path.resolve(observedPath);
      const relative = path.relative(root, absolute);
      if (!relative) return false;
      if (relative.split(path.sep).some((segment) => segment.startsWith('.'))) return true;
      if (stats?.isSymbolicLink()) return true;
      if (!stats?.isFile()) return false;
      const normalized = relative.split(path.sep).join('/');
      if (normalized === 'index.md' || normalized === 'log.md') return true;
      return path.extname(normalized).toLowerCase() !== '.md';
    },
  });

  const flush = async () => {
    if (running || !pending.size) return;
    const batch = [...pending.entries()].map(([relativePath, event]) => ({ event, path: relativePath }));
    pending.clear();
    running = true;
    try { await options.onBatch(batch); }
    catch (error) { options.onError?.(error instanceof Error ? error : new Error(String(error))); }
    finally {
      running = false;
      if (pending.size) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { void flush(); }, debounceMs);
      }
    }
  };

  watcher.on('ready', () => options.onReady?.());
  watcher.on('error', (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))));
  watcher.on('all', (event, absolutePath) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (!relativePath || relativePath.startsWith('../') || relativePath.split('/').some((segment) => segment.startsWith('.'))
      || !relativePath.toLowerCase().endsWith('.md') || relativePath === 'index.md' || relativePath === 'log.md') return;
    pending.set(relativePath, event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, debounceMs);
  });
  return watcher;
}
