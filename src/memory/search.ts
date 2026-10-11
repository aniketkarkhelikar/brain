import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { MemoryDatabase, type IndexedChunk, type IndexedVaultDocument, type RankedChunkId, type VaultDocument, type VaultPathFilter } from './db.js';
import { embedTexts, embeddingModelName } from './embeddings.js';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../providers.js';

// MiniLM is limited to a 512-token input. Four characters per token is a
// practical English-Markdown estimate: 1,600 chars ≈ 400 tokens; overlap is
// 200 chars ≈ 50 tokens. Boundaries are kept near paragraph/word edges.
export const CHUNK_TARGET_TOKENS = 400;
export const CHUNK_OVERLAP_TOKENS = 50;
export const APPROX_CHARS_PER_TOKEN = 4;
export const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;
export const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;
const EMBEDDING_BATCH_SIZE = 16;
const INDEX_START = '<!-- AI_BRAIN_INDEX_START -->';
const INDEX_END = '<!-- AI_BRAIN_INDEX_END -->';
const RRF_K = 60;
const MIN_COSINE_SIMILARITY = 0.28;
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'may', 'might', 'of', 'on', 'or', 'our', 'should', 'so', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'us', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'your',
]);

export type MarkdownChunk = { chunkIndex: number; startOffset: number; endOffset: number; content: string };
export type SearchResult = {
  file: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  chunkIndex: number;
  score: number;
  snippet: string;
  matches: string[];
  documentContent?: string;
  contentMode?: 'full-document' | 'matching-passages';
};
export type HybridSearchResult = {
  success: true;
  query: string;
  totalMatches: number;
  truncated: boolean;
  results: SearchResult[];
};
export type IndexStats = {
  filesFound: number;
  filesAdded: number;
  filesUpdated: number;
  filesUnchanged: number;
  filesDeleted: number;
  chunksIndexed: number;
  embeddingModel: string;
  embeddingDimensions: number;
};
export type MemorySearchOptions = {
  vaultPath?: string;
  dbPath?: string;
  model?: string;
  embeddingDimensions?: number;
  embedMany?: (values: string[]) => Promise<number[][]>;
  includePrefixes?: string[];
  excludePrefixes?: string[];
};

type ScannedDocument = VaultDocument & { content: string };

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isFileNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function vaultRoot(options?: MemorySearchOptions): string {
  return path.resolve(options?.vaultPath || process.env.VAULT_PATH || './vault');
}

function databasePath(options?: MemorySearchOptions): string {
  return options?.dbPath || process.env.BRAIN_MEMORY_DB || './state/memory.sqlite';
}

function displayTitle(parsedTitle: unknown, markdownContent: string, relativePath: string): string {
  if (typeof parsedTitle === 'string' && parsedTitle.trim()) return parsedTitle.trim();
  const heading = markdownContent.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  return heading?.trim() || path.basename(relativePath, path.extname(relativePath));
}

function firstParagraph(content: string): string {
  const paragraphs = content
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^#{1,6}\s/.test(paragraph) && !/^!\[/.test(paragraph) && !/^[-*_]{3,}$/.test(paragraph));
  return paragraphs[0]?.replace(/\s+/g, ' ').trim() ?? '';
}

function fileTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function scanMetadata(raw: string, relativePath: string, modifiedAt: number): ScannedDocument {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const title = displayTitle(data.title, parsed.content, relativePath);
  const frontMatterDescription = typeof data.description === 'string' ? data.description.trim() : '';
  const description = frontMatterDescription || firstParagraph(parsed.content) || `Markdown note: ${title}`;
  return {
    path: relativePath,
    title,
    description: description.slice(0, 600),
    tags: fileTags(data.tags),
    contentHash: createHash('sha256').update(raw).digest('hex'),
    modifiedAt,
    content: parsed.content,
  };
}

function fileProfileText(document: ScannedDocument): string {
  const headings = [...document.content.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => match[1].trim())
    .slice(0, 40)
    .join('; ');
  return [
    `File: ${document.path}`,
    `Title: ${document.title}`,
    `Description: ${document.description}`,
    document.tags.length ? `Tags: ${document.tags.join(', ')}` : '',
    headings ? `Headings: ${headings}` : '',
  ].filter(Boolean).join('\n').slice(0, 680);
}

async function walkMarkdown(root: string, relativeDirectory = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const files: string[] = [];
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkMarkdown(root, relative));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && normalizeRelativePath(relative) !== 'index.md') {
      files.push(normalizeRelativePath(relative));
    }
  }
  return files;
}

function slidingWindowChunks(
  text: string,
  targetChars: number,
  overlapChars: number,
  baseOffset = 0,
  contextPrefix = '',
): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const maxContentChars = Math.max(32, targetChars - (contextPrefix ? contextPrefix.length + 2 : 0));
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxContentChars, text.length);
    if (end < text.length) {
      const paragraphBoundary = text.lastIndexOf('\n\n', end);
      if (paragraphBoundary > start + maxContentChars * 0.6) {
        end = paragraphBoundary;
      } else {
        const wordBoundary = text.lastIndexOf(' ', end);
        if (wordBoundary > start + maxContentChars * 0.6) end = wordBoundary;
      }
    }

    const rawSegment = text.slice(start, end).trim();
    if (rawSegment) {
      const contentStart = text.indexOf(rawSegment, start);
      const chunkBody = contextPrefix ? `${contextPrefix}\n\n${rawSegment}` : rawSegment;
      chunks.push({
        chunkIndex: chunks.length,
        startOffset: baseOffset + Math.max(0, contentStart),
        endOffset: baseOffset + Math.max(0, contentStart) + rawSegment.length,
        content: chunkBody,
      });
    }
    if (end >= text.length) break;

    let nextStart = Math.max(start + 1, end - overlapChars);
    while (nextStart < end && !/\s/.test(text[nextStart])) nextStart += 1;
    start = Math.max(end - overlapChars, nextStart);
    while (start < text.length && /\s/.test(text[start])) start += 1;
  }
  return chunks;
}

export function chunkMarkdown(
  markdown: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
): MarkdownChunk[] {
  if (!Number.isSafeInteger(targetChars) || targetChars < 32) throw new Error('targetChars must be an integer of at least 32.');
  if (!Number.isSafeInteger(overlapChars) || overlapChars < 0 || overlapChars >= targetChars) {
    throw new Error('overlapChars must be a non-negative integer smaller than targetChars.');
  }

  const text = markdown.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  // If no markdown headings exist, or targetChars is too small for context prefixing,
  // use pure sliding window.
  const hasHeadings = /^#{1,6}\s+/m.test(text);
  if (!hasHeadings || targetChars < 250) {
    return slidingWindowChunks(text, targetChars, overlapChars);
  }

  // Parse structural sections based on markdown headings
  const headingRegex = /(?:^|\n)(#{1,6})\s+([^\n]+)/g;
  const sections: Array<{
    headingLevel: number;
    title: string;
    startIndex: number;
    endIndex: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    const level = match[1].length;
    const title = match[2].trim();
    const headingStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    if (sections.length > 0) {
      sections[sections.length - 1].endIndex = headingStart;
    }
    sections.push({
      headingLevel: level,
      title,
      startIndex: headingStart,
      endIndex: text.length,
    });
  }

  const chunks: MarkdownChunk[] = [];
  if (sections.length > 0 && sections[0].startIndex > 0) {
    const preamble = text.slice(0, sections[0].startIndex).trim();
    if (preamble) {
      chunks.push(...slidingWindowChunks(preamble, targetChars, overlapChars, 0));
    }
  }

  const headingStack: Array<{ level: number; title: string }> = [];

  for (const section of sections) {
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= section.headingLevel) {
      headingStack.pop();
    }
    headingStack.push({ level: section.headingLevel, title: section.title });

    const breadcrumb = `[Context: ${headingStack.map((h) => h.title).join(' > ')}]`;
    const sectionBody = text.slice(section.startIndex, section.endIndex).trim();
    if (!sectionBody) continue;

    const sectionChunks = slidingWindowChunks(
      sectionBody,
      targetChars,
      overlapChars,
      section.startIndex,
      breadcrumb,
    );
    for (const chunk of sectionChunks) {
      chunks.push({
        ...chunk,
        chunkIndex: chunks.length,
      });
    }
  }

  return chunks.length > 0 ? chunks : slidingWindowChunks(text, targetChars, overlapChars);
}

type EmbeddedChunk = { chunk: MarkdownChunk; embedding: number[] };

function isContextLengthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const responseBody = (error as { responseBody?: unknown }).responseBody;
  if (typeof responseBody !== 'string') return false;
  return /input length.{0,40}(?:exceed|context length)|context length.{0,40}exceed/i.test(responseBody);
}

function splitChunk(chunk: MarkdownChunk): MarkdownChunk[] {
  const targetChars = Math.max(32, Math.floor(chunk.content.length / 2));
  if (targetChars >= chunk.content.length) return [];
  const overlapChars = Math.max(1, Math.floor(targetChars / 8));
  return chunkMarkdown(chunk.content, targetChars, Math.min(overlapChars, targetChars - 1)).map((part) => ({
    ...part,
    startOffset: chunk.startOffset + part.startOffset,
    endOffset: chunk.startOffset + part.endOffset,
  }));
}

async function embedChunkBatch(
  chunks: MarkdownChunk[],
  embedMany: (values: string[]) => Promise<number[][]>,
): Promise<EmbeddedChunk[]> {
  try {
    const vectors = await embedMany(chunks.map((chunk) => chunk.content));
    if (vectors.length !== chunks.length) throw new Error('Embedding provider returned an unexpected number of vectors.');
    return chunks.map((chunk, index) => ({ chunk, embedding: vectors[index] }));
  } catch (error) {
    if (!isContextLengthError(error)) throw error;
    if (chunks.length > 1) {
      const middle = Math.floor(chunks.length / 2);
      return [
        ...await embedChunkBatch(chunks.slice(0, middle), embedMany),
        ...await embedChunkBatch(chunks.slice(middle), embedMany),
      ];
    }

    const oversized = chunks[0];
    const smallerChunks = splitChunk(oversized);
    if (smallerChunks.length < 2) {
      throw new Error(`A Markdown chunk at offset ${oversized.startOffset} still exceeds the Ollama context limit after subdivision.`);
    }
    const embedded: EmbeddedChunk[] = [];
    for (const smallerChunk of smallerChunks) {
      embedded.push(...await embedChunkBatch([smallerChunk], embedMany));
    }
    return embedded;
  }
}

async function embedChunks(
  chunks: MarkdownChunk[],
  embedMany: (values: string[]) => Promise<number[][]>,
): Promise<EmbeddedChunk[]> {
  const embedded: EmbeddedChunk[] = [];
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    embedded.push(...await embedChunkBatch(chunks.slice(start, start + EMBEDDING_BATCH_SIZE), embedMany));
  }
  return embedded;
}

function markdownCell(value: string): string {
  return value.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
}

function markdownLinkPath(relativePath: string): string {
  return `./${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function renderCatalog(documents: IndexedVaultDocument[]): string {
  const rows = documents.map((document) => {
    const filename = path.posix.basename(document.path);
    const file = `[${markdownCell(document.title)} (${markdownCell(filename)})](${markdownLinkPath(document.path)})`;
    const description = markdownCell(document.description).slice(0, 300);
    return `| ${file} | ${description} | \`${markdownCell(document.path)}\` |`;
  });
  const table = rows.length
    ? ['| File | Description | Relative path |', '| --- | --- | --- |', ...rows].join('\n')
    : '_No Markdown files indexed yet._';
  return `${INDEX_START}\n\n## Indexed Vault Files\n\n${table}\n\n${INDEX_END}`;
}

async function updateCatalog(vaultPath: string, documents: IndexedVaultDocument[]): Promise<void> {
  const indexPath = path.join(vaultPath, 'index.md');
  let index = '';
  try {
    index = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
    index = '# Vault Index\n\n_Auto-maintained file catalog. Edit file descriptions in frontmatter to improve retrieval._\n';
  }

  const block = renderCatalog(documents);
  const existingBlock = new RegExp(`${INDEX_START}[\\s\\S]*?${INDEX_END}`);
  if (existingBlock.test(index)) {
    index = index.replace(existingBlock, block);
  } else {
    const oldWikiHeading = /^## Wiki Pages\s*$/m;
    const match = oldWikiHeading.exec(index);
    if (match) index = `${index.slice(0, match.index).trimEnd()}\n\n${block}\n`;
    else index = `${index.trimEnd()}\n\n${block}\n`;
  }

  const temporaryPath = `${indexPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, index, { mode: 0o600 });
  await fs.rename(temporaryPath, indexPath);
}

export async function indexVault(options: MemorySearchOptions = {}): Promise<IndexStats> {
  const root = vaultRoot(options);
  const model = options.model || embeddingModelName();
  const embedMany = options.embedMany || embedTexts;
  const configuredDimensions = options.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const database = new MemoryDatabase(databasePath(options));
  const stats: IndexStats = {
    filesFound: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesUnchanged: 0,
    filesDeleted: 0,
    chunksIndexed: 0,
    embeddingModel: model,
    embeddingDimensions: configuredDimensions,
  };

  try {
    database.configureEmbeddingSpace(model, configuredDimensions);
    const filePaths = await walkMarkdown(root);
    const availablePaths = new Set(filePaths);
    stats.filesFound = filePaths.length;
    let observedDimension: number | undefined;
    const pendingDocuments: Array<{
      document: ScannedDocument;
      existed: boolean;
      chunks: IndexedChunk[];
      profile: string;
    }> = [];

    for (const relativePath of filePaths) {
      const fullPath = path.join(root, ...relativePath.split('/'));
      const [raw, fileStats] = await Promise.all([fs.readFile(fullPath, 'utf8'), fs.stat(fullPath)]);
      const document = scanMetadata(raw, relativePath, fileStats.mtimeMs);
      if (database.isDocumentCurrent(document.path, document.contentHash, model, configuredDimensions)) {
        stats.filesUnchanged += 1;
        continue;
      }

      const chunks = chunkMarkdown(document.content);
      let embedded: EmbeddedChunk[];
      try {
        // Compact file profiles provide a coarse catalog route. Body chunks
        // are still searched globally so a detail omitted from the profile is
        // not hidden behind a hard first-stage filter.
        embedded = await embedChunks(chunks, embedMany);
      } catch (error) {
        throw new Error(`Embedding failed for "${relativePath}": ${error instanceof Error ? error.message : String(error)}`);
      }
      const chunkVectors = embedded.map(({ embedding }) => embedding);
      if (chunkVectors.length) {
        if (!chunkVectors[0].length || chunkVectors.some((vector) => vector.length !== chunkVectors[0].length || vector.some((value) => !Number.isFinite(value)))) {
          throw new Error(`Embedding model returned inconsistent vectors for "${relativePath}".`);
        }
        const dimensions = chunkVectors[0].length;
        if (options.embeddingDimensions === undefined && dimensions !== DEFAULT_EMBEDDING_DIMENSIONS) {
          throw new Error(`Ollama ${model} must return ${DEFAULT_EMBEDDING_DIMENSIONS}-dimensional vectors; received ${dimensions}.`);
        }
        if (observedDimension !== undefined && observedDimension !== dimensions) {
          throw new Error('Embedding model returned different dimensions within one vault-indexing run.');
        }
        observedDimension = dimensions;
        if (dimensions !== database.embeddingDimensions) database.configureEmbeddingSpace(model, dimensions);
        stats.embeddingDimensions = dimensions;
      }
      const indexedChunks: IndexedChunk[] = embedded.map(({ chunk, embedding }, index) => ({
        ...chunk,
        chunkIndex: index,
        embedding,
      }));

      pendingDocuments.push({
        document,
        existed: database.hasDocument(relativePath),
        chunks: indexedChunks,
        profile: fileProfileText(document),
      });
    }

    // Profile vectors are sent in batches across files to keep catalog routing
    // inexpensive even when a vault contains many short notes.
    for (let start = 0; start < pendingDocuments.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pendingDocuments.slice(start, start + EMBEDDING_BATCH_SIZE);
      const profiles = await embedMany(batch.map(({ profile }) => profile));
      if (profiles.length !== batch.length) throw new Error('Embedding provider returned an unexpected number of file-profile vectors.');
      for (let index = 0; index < batch.length; index += 1) {
        const profileEmbedding = profiles[index];
        if (!profileEmbedding?.length || profileEmbedding.some((value) => !Number.isFinite(value))) {
          throw new Error(`Embedding model returned an invalid file profile for "${batch[index].document.path}".`);
        }
        const dimensions = profileEmbedding.length;
        if (options.embeddingDimensions === undefined && dimensions !== DEFAULT_EMBEDDING_DIMENSIONS) {
          throw new Error(`Ollama ${model} must return ${DEFAULT_EMBEDDING_DIMENSIONS}-dimensional vectors; received ${dimensions}.`);
        }
        if (observedDimension !== undefined && observedDimension !== dimensions) {
          throw new Error('Embedding model returned different dimensions within one vault-indexing run.');
        }
        observedDimension = dimensions;
        if (dimensions !== database.embeddingDimensions) database.configureEmbeddingSpace(model, dimensions);
        stats.embeddingDimensions = dimensions;
        const pending = batch[index];
        database.upsertDocument(pending.document, model, dimensions, pending.chunks, profileEmbedding);
        stats.chunksIndexed += pending.chunks.length;
        if (pending.existed) stats.filesUpdated += 1;
        else stats.filesAdded += 1;
      }
    }

    stats.filesDeleted = database.deleteMissingDocuments(availablePaths);
    const documents = database.listDocuments();
    await updateCatalog(root, documents);
    stats.embeddingDimensions = database.embeddingDimensions || configuredDimensions;
    return stats;
  } finally {
    database.close();
  }
}

function ftsQuery(query: string): string {
  const allTerms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term.toLocaleLowerCase()));
  const terms = meaningful.length ? meaningful : allTerms;
  return [...new Set(terms.map((term) => term.slice(0, 80)))].slice(0, 16).map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

function snippetFor(content: string, query: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const lower = clean.toLowerCase();
  let location = -1;
  for (const term of terms) {
    location = lower.indexOf(term.toLowerCase());
    if (location >= 0) break;
  }
  if (clean.length <= 420) return clean;
  if (location < 0) return `${clean.slice(0, 417)}...`;
  const start = Math.max(0, location - 150);
  const end = Math.min(clean.length, location + 270);
  return `${start ? '...' : ''}${clean.slice(start, end)}${end < clean.length ? '...' : ''}`;
}

export function reciprocalRankFusion(rankedLists: number[][], rankConstant = RRF_K): Map<number, number> {
  const scores = new Map<number, number>();
  for (const ranked of rankedLists) {
    const seen = new Set<number>();
    ranked.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rankConstant + index + 1));
    });
  }
  return scores;
}

function metadataFileRank(query: string, documents: IndexedVaultDocument[]): number[] {
  const normalized = query.toLocaleLowerCase();
  const allTerms = [...new Set(query.match(/[\p{L}\p{N}_-]+/gu) ?? [])].map((term) => term.toLocaleLowerCase());
  const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term));
  const terms = meaningful.length ? meaningful : allTerms;
  return documents.map((document) => {
    const file = `${document.path} ${path.posix.basename(document.path, '.md')}`.toLocaleLowerCase();
    const title = document.title.toLocaleLowerCase();
    const description = `${document.description} ${document.tags.join(' ')}`.toLocaleLowerCase();
    const searchable = `${file} ${title} ${description}`;
    const matchedTerms = terms.filter((term) => searchable.includes(term)).length;
    const exactBoost = file.includes(normalized) || title.includes(normalized) ? 2 : 0;
    const titleHits = terms.filter((term) => title.includes(term)).length;
    return { id: document.id, score: exactBoost + titleHits * 1.5 + matchedTerms / Math.max(terms.length, 1) };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .map((item) => item.id);
}

function usefulQueryTerms(query: string): string[] {
  const allTerms = [...new Set(query.match(/[\p{L}\p{N}_-]+/gu) ?? [])].map((term) => term.toLocaleLowerCase());
  const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term));
  return meaningful.length ? meaningful : allTerms;
}

function termCoverage(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const normalized = text.toLocaleLowerCase();
  return terms.filter((term) => normalized.includes(term)).length / terms.length;
}

export async function searchVault(
  query: string,
  maxResults = 10,
  options: MemorySearchOptions = {},
): Promise<HybridSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error('Search query cannot be empty.');
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throw new Error('maxResults must be an integer between 1 and 50.');
  }

  const model = options.model || embeddingModelName();
  await indexVault({ ...options, model });
  const embedMany = options.embedMany || embedTexts;
  const [queryVector] = await embedMany([normalizedQuery]);
  if (!queryVector?.length || queryVector.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding model returned an invalid query vector.');
  }

  const database = new MemoryDatabase(databasePath(options));
  try {
    if (database.embeddingModel !== model || database.embeddingDimensions !== queryVector.length) {
      throw new Error(
        `Query embedding space (${model}, ${queryVector.length} dimensions) does not match indexed vault (${database.embeddingModel ?? 'unconfigured'}, ${database.embeddingDimensions ?? 'unconfigured'} dimensions).`,
      );
    }
    const candidateLimit = Math.min(200, Math.max(80, maxResults * 8));
    const filter: VaultPathFilter = {
      includePrefixes: options.includePrefixes,
      excludePrefixes: options.excludePrefixes,
    };
    const profiles = database.searchFileProfiles(queryVector, candidateLimit, filter);
    const semantic = database.searchVector(queryVector, candidateLimit, filter);
    const lexical = database.searchKeyword(ftsQuery(normalizedQuery), candidateLimit, filter);
    const documents = database.listDocuments().filter((document) => {
      const included = !filter.includePrefixes?.length || filter.includePrefixes.some((prefix) => {
        const normalized = prefix.replace(/\/+$/, '');
        return document.path === normalized || document.path.startsWith(`${normalized}/`);
      });
      const excluded = filter.excludePrefixes?.some((prefix) => {
        const normalized = prefix.replace(/\/+$/, '');
        return document.path === normalized || document.path.startsWith(`${normalized}/`);
      });
      return included && !excluded;
    });
    const fileById = new Map(documents.map((document) => [document.id, document]));
    const chunkById = new Map(database.getChunks([...new Set([...semantic, ...lexical].map((result) => result.chunkId))])
      .map((chunk) => [chunk.chunkId, chunk]));
    const chunksByFile = new Map<number, number[]>();
    for (const result of [...lexical, ...semantic]) {
      const chunk = chunkById.get(result.chunkId);
      if (chunk) chunksByFile.set(chunk.fileId, [...(chunksByFile.get(chunk.fileId) ?? []), result.chunkId]);
    }
    const fileRanks = (rankedChunks: RankedChunkId[]) => [...new Set(rankedChunks
      .map((result) => chunkById.get(result.chunkId)?.fileId)
      .filter((id): id is number => id !== undefined))];
    const fileScores = reciprocalRankFusion([
      profiles.map((result) => result.fileId),
      fileRanks(semantic),
      fileRanks(lexical),
      metadataFileRank(normalizedQuery, documents),
    ]);
    const profilesByFile = new Map(profiles.map((result) => [result.fileId, result]));
    const semanticSimilarityByFile = new Map<number, number>();
    for (const result of semantic) {
      const fileId = chunkById.get(result.chunkId)?.fileId;
      if (fileId === undefined) continue;
      semanticSimilarityByFile.set(fileId, Math.max(
        semanticSimilarityByFile.get(fileId) ?? -1,
        1 - (result.distance ?? 1),
      ));
    }
    const minimumCoverage = usefulQueryTerms(normalizedQuery).length >= 4 ? 0.5 : 1;
    const queryTerms = usefulQueryTerms(normalizedQuery);
    const fileIds = [...fileScores.keys()].filter((id) => {
      const document = fileById.get(id);
      if (!document) return false;
      const candidateChunks = chunksByFile.get(id) ?? [];
      const passages = candidateChunks.map((chunkId) => chunkById.get(chunkId)?.content ?? '').join('\n');
      const searchable = `${document.path} ${document.title} ${document.description} ${document.tags.join(' ')} ${passages}`;
      const metadataExact = document.path.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()) ||
        document.title.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase());
      const lexicalCoverage = termCoverage(searchable, queryTerms);
      const semanticSimilarity = semanticSimilarityByFile.get(id) ?? -1;
      const profileSimilarity = 1 - (profilesByFile.get(id)?.distance ?? 1);
      return metadataExact || lexicalCoverage >= minimumCoverage ||
        Math.max(semanticSimilarity, profileSimilarity) >= MIN_COSINE_SIMILARITY;
    })
      .sort((left, right) => (fileScores.get(right)! - fileScores.get(left)!) || left - right);
    const chunkScores = reciprocalRankFusion([
      semantic.map((result) => result.chunkId),
      lexical.map((result) => result.chunkId),
    ]);
    const firstChunks = new Map(database.getFirstChunks(fileIds).map((chunk) => [chunk.fileId, chunk]));
    const results: SearchResult[] = fileIds.slice(0, maxResults).map((fileId) => {
      const document = fileById.get(fileId)!;
      const candidateChunks = [...new Set(chunksByFile.get(fileId) ?? [])];
      candidateChunks.sort((left, right) => (chunkScores.get(right) ?? 0) - (chunkScores.get(left) ?? 0) || left - right);
      const chunk = (candidateChunks[0] ? chunkById.get(candidateChunks[0]) : undefined) ?? firstChunks.get(fileId);
      const snippet = snippetFor(chunk?.content || document.description, normalizedQuery);
      const matches = candidateChunks.slice(0, 3).map((id) => chunkById.get(id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .map((candidate) => snippetFor(candidate.content, normalizedQuery));
      return {
        file: document.path,
        path: document.path,
        title: document.title,
        description: document.description,
        tags: document.tags,
        chunkIndex: chunk?.chunkIndex ?? -1,
        score: fileScores.get(fileId) ?? 0,
        snippet,
        matches: matches.length ? matches : [snippet],
      };
    });

    const candidateFileCount = fileIds.length;
    return {
      success: true,
      query: normalizedQuery,
      totalMatches: candidateFileCount,
      truncated: candidateFileCount > results.length,
      results,
    };
  } finally {
    database.close();
  }
}
