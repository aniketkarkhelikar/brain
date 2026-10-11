export type ChatSource = {
  kind: 'web' | 'memory' | 'skill' | 'status';
  title: string;
  url?: string;
  path?: string;
  verified?: boolean;
  access?: 'retrieved' | 'read' | 'catalog';
};

export type ToolTraceStep = { name: string; skillName?: string };

export function normalizeToolTrace(steps: ToolTraceStep[]): ToolTraceStep[] {
  const allowed = new Set(['vaultSearch', 'vaultRead', 'vaultList', 'vaultCatalog', 'webSearch', 'webRead', 'skillLoad', 'vaultWrite']);
  return steps.flatMap((step) => {
    if (!step || !allowed.has(step.name)) return [];
    const skillName = step.name === 'skillLoad' && typeof step.skillName === 'string'
      ? step.skillName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
      : undefined;
    return [{ name: step.name, ...(skillName ? { skillName } : {}) }];
  }).slice(0, 32);
}

export function hasMemoryEvidence(result: Record<string, unknown>): boolean {
  const candidateText = [result.snippet, result.documentContent, result.content, ...(Array.isArray(result.matches) ? result.matches : [])];
  return candidateText.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 180) : undefined;
}

export function normalizeChatSources(sources: ChatSource[]): ChatSource[] {
  const normalized = new Map<string, ChatSource>();
  for (const source of sources) {
    const title = cleanTitle(source.title);
    if (!title || !['web', 'memory'].includes(source.kind)) continue;
    let url: string | undefined;
    if (source.url) {
      try {
        const parsed = new URL(source.url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
        url = parsed.href;
      } catch {
        continue;
      }
    }
    const path = typeof source.path === 'string'
      && source.path.length <= 1024
      && !source.path.startsWith('/')
      && !source.path.split(/[\\/]/).includes('..')
      ? source.path
      : undefined;
    if (source.kind === 'web' && !url) continue;
    if (source.kind === 'memory' && !path) continue;
    const access = ['retrieved', 'read', 'catalog'].includes(String(source.access)) ? source.access : undefined;
    const item: ChatSource = { kind: source.kind, title, ...(url ? { url } : {}), ...(path ? { path } : {}), ...(typeof source.verified === 'boolean' ? { verified: source.verified } : {}), ...(access ? { access } : {}) };
    const key = `${item.kind}:${item.url || item.path || title}`;
    const existing = normalized.get(key);
    const sourcePriority = (value: ChatSource) => value.access === 'read' ? 3 : value.access === 'retrieved' ? 2 : value.access === 'catalog' ? 1 : value.verified ? 3 : 0;
    if (!existing || sourcePriority(item) > sourcePriority(existing)) normalized.set(key, item);
  }
  return [...normalized.values()].slice(0, 16);
}

export function chatSourcesFromToolResults(toolResults: unknown[]): ChatSource[] {
  const sources: ChatSource[] = [];
  for (const result of toolResults) {
    if (!result || typeof result !== 'object') continue;
    const item = result as { toolName?: unknown; output?: unknown };
    const output = item.output && typeof item.output === 'object' ? item.output as Record<string, any> : undefined;
    if (!output) continue;
    if (output.success === false) continue;
    if (item.toolName === 'webSearch' && Array.isArray(output.results)) {
      for (const result of output.results) {
        if (!result || typeof result !== 'object') continue;
        sources.push({ kind: 'web', title: result.title, url: result.url, verified: false });
      }
    } else if (item.toolName === 'webRead') {
      sources.push({ kind: 'web', title: output.title || output.url, url: output.url, verified: true });
    } else if (item.toolName === 'vaultSearch' && Array.isArray(output.results)) {
      for (const result of output.results) {
        if (!result || typeof result !== 'object') continue;
        if (!hasMemoryEvidence(result as Record<string, unknown>)) continue;
        sources.push({ kind: 'memory', title: result.title || result.path, path: result.path, access: 'retrieved' });
      }
    } else if (item.toolName === 'vaultRead') {
      if (typeof output.content === 'string' && output.content.trim()) {
        sources.push({ kind: 'memory', title: output.path, path: output.path, access: 'read' });
      }
    }
  }
  return normalizeChatSources(sources);
}
