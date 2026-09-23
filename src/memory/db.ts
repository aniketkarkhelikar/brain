import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export type VaultDocument = {
  path: string;
  title: string;
  description: string;
  tags: string[];
  contentHash: string;
  modifiedAt: number;
};

export type IndexedVaultDocument = VaultDocument & { id: number };

export type IndexedChunk = {
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  content: string;
  embedding: number[];
};

export type VaultPathFilter = {
  includePrefixes?: string[];
  excludePrefixes?: string[];
};

export type RetrievedChunk = {
  chunkId: number;
  chunkIndex: number;
  content: string;
  fileId: number;
  path: string;
  title: string;
  description: string;
  tags: string[];
};

type FileRow = {
  id: number;
  path: string;
  title: string;
  description: string;
  tags_json: string;
  content_hash: string;
  modified_at: number;
  embedding_model: string;
  embedding_dimensions: number;
};

export type RankedChunkId = { chunkId: number; rank: number; distance?: number };
export type RankedFileId = { fileId: number; rank: number; distance?: number };

function parseTags(serialized: string): string[] {
  try {
    const tags: unknown = JSON.parse(serialized);
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export class MemoryDatabase {
  private readonly db: Database.Database;
  private readonly databasePath: string;

  constructor(databasePath = process.env.BRAIN_MEMORY_DB || './state/memory.sqlite') {
    this.databasePath = databasePath === ':memory:' ? databasePath : path.resolve(databasePath);
    if (this.databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(this.databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    sqliteVec.load(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_files (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        modified_at INTEGER NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_dimensions INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY,
        file_id INTEGER NOT NULL REFERENCES memory_files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        content TEXT NOT NULL,
        UNIQUE(file_id, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        content,
        title,
        description,
        tags,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS memory_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    if (this.databasePath !== ':memory:') {
      try {
        fs.chmodSync(this.databasePath, 0o600);
      } catch {
        // File permission hardening is best effort on filesystems without chmod support.
      }
    }
  }

  get embeddingModel(): string | undefined {
    return this.getMetadata('embedding_model');
  }

  get embeddingDimensions(): number | undefined {
    const value = this.getMetadata('embedding_dimensions');
    return value ? Number(value) : undefined;
  }

  configureEmbeddingSpace(model: string, dimensions: number): boolean {
    if (!model.trim()) throw new Error('Embedding model name is required.');
    if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 8192) {
      throw new Error('Embedding dimensions must be an integer between 1 and 8192.');
    }

    const sameSpace = this.embeddingModel === model &&
      this.embeddingDimensions === dimensions &&
      this.getMetadata('embedding_metric') === 'cosine';
    const hasVectorTable = Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_vectors'",
    ).get());
    const hasFileVectorTable = Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_file_vectors'",
    ).get());
    if (sameSpace && hasVectorTable && hasFileVectorTable) return false;

    const configure = this.db.transaction(() => {
      if (!sameSpace) {
        this.db.exec('DROP TABLE IF EXISTS memory_vectors');
        this.db.exec('DROP TABLE IF EXISTS memory_file_vectors');
      }
      if (!hasVectorTable || !sameSpace) {
        this.db.exec(`CREATE VIRTUAL TABLE memory_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine)`);
      }
      if (!hasFileVectorTable || !sameSpace) {
        this.db.exec(`CREATE VIRTUAL TABLE memory_file_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine)`);
      }
      this.setMetadata('embedding_model', model);
      this.setMetadata('embedding_dimensions', String(dimensions));
      this.setMetadata('embedding_metric', 'cosine');
    });
    configure();
    return true;
  }

  isDocumentCurrent(documentPath: string, contentHash: string, model: string, dimensions: number): boolean {
    const row = this.db.prepare(`
      SELECT content_hash, embedding_model, embedding_dimensions
      FROM memory_files WHERE path = ?
    `).get(documentPath) as Pick<FileRow, 'content_hash' | 'embedding_model' | 'embedding_dimensions'> | undefined;
    if (!row || row.content_hash !== contentHash || row.embedding_model !== model || row.embedding_dimensions !== dimensions) {
      return false;
    }

    // A previous interrupted process or a damaged index can leave file hashes
    // current while its FTS/vector rows are missing. Rebuild those files instead
    // of silently treating the incomplete index as current.
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM memory_chunks c WHERE c.file_id = f.id) AS chunks,
        (SELECT COUNT(*) FROM memory_chunks c JOIN memory_chunks_fts x ON x.rowid = c.id WHERE c.file_id = f.id) AS keywords,
        (SELECT COUNT(*) FROM memory_chunks c JOIN memory_vectors v ON v.rowid = c.id WHERE c.file_id = f.id) AS vectors,
        (SELECT COUNT(*) FROM memory_file_vectors v WHERE v.rowid = f.id) AS profile_vectors
      FROM memory_files f WHERE f.path = ?
    `).get(documentPath) as { chunks: number; keywords: number; vectors: number; profile_vectors: number } | undefined;
    return Boolean(counts && counts.chunks === counts.keywords && counts.chunks === counts.vectors && counts.profile_vectors === 1);
  }

  hasDocument(documentPath: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM memory_files WHERE path = ?').get(documentPath));
  }

  upsertDocument(
    document: VaultDocument,
    model: string,
    dimensions: number,
    chunks: IndexedChunk[],
    profileEmbedding: number[],
  ): void {
    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM memory_files WHERE path = ?').get(document.path) as { id: number } | undefined;
      let fileId: number;
      if (existing) {
        fileId = existing.id;
        const previousChunkIds = this.db.prepare('SELECT id FROM memory_chunks WHERE file_id = ?').all(fileId) as Array<{ id: number }>;
        for (const { id } of previousChunkIds) {
          this.db.prepare('DELETE FROM memory_chunks_fts WHERE rowid = ?').run(id);
          this.db.prepare('DELETE FROM memory_vectors WHERE rowid = ?').run(BigInt(id));
        }
        this.db.prepare('DELETE FROM memory_chunks WHERE file_id = ?').run(fileId);
        this.db.prepare(`
          UPDATE memory_files SET title = ?, description = ?, tags_json = ?, content_hash = ?,
            modified_at = ?, embedding_model = ?, embedding_dimensions = ?, indexed_at = ?
          WHERE id = ?
        `).run(
          document.title,
          document.description,
          JSON.stringify(document.tags),
          document.contentHash,
          document.modifiedAt,
          model,
          dimensions,
          new Date().toISOString(),
          fileId,
        );
      } else {
        const inserted = this.db.prepare(`
          INSERT INTO memory_files (path, title, description, tags_json, content_hash, modified_at, embedding_model, embedding_dimensions, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          document.path,
          document.title,
          document.description,
          JSON.stringify(document.tags),
          document.contentHash,
          document.modifiedAt,
          model,
          dimensions,
          new Date().toISOString(),
        );
        fileId = Number(inserted.lastInsertRowid);
      }

      if (profileEmbedding.length !== dimensions || profileEmbedding.some((value) => !Number.isFinite(value))) {
        throw new Error(`Invalid file-profile embedding dimensions or values while indexing "${document.path}".`);
      }
      this.db.prepare('DELETE FROM memory_file_vectors WHERE rowid = ?').run(BigInt(fileId));
      this.db.prepare('INSERT INTO memory_file_vectors (rowid, embedding) VALUES (?, ?)').run(
        BigInt(fileId),
        Buffer.from(new Float32Array(profileEmbedding).buffer),
      );

      const insertChunk = this.db.prepare(`
        INSERT INTO memory_chunks (file_id, chunk_index, start_offset, end_offset, content)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO memory_chunks_fts (rowid, content, title, description, tags)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertVector = chunks.length
        ? this.db.prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (?, ?)')
        : undefined;

      for (const chunk of chunks) {
        if (chunk.embedding.length !== dimensions || chunk.embedding.some((value) => !Number.isFinite(value))) {
          throw new Error(`Invalid embedding dimensions or values while indexing "${document.path}".`);
        }
        const inserted = insertChunk.run(fileId, chunk.chunkIndex, chunk.startOffset, chunk.endOffset, chunk.content);
        const chunkId = Number(inserted.lastInsertRowid);
        insertFts.run(chunkId, chunk.content, document.title, document.description, document.tags.join(' '));
        // sqlite-vec 0.1.7+ can reject Number-bound vec0 primary keys from
        // better-sqlite3. BigInt keeps the rowid binding unambiguous.
        insertVector!.run(BigInt(chunkId), Buffer.from(new Float32Array(chunk.embedding).buffer));
      }
    });
    transaction();
  }

  deleteMissingDocuments(availablePaths: Set<string>): number {
    const rows = this.db.prepare('SELECT id, path FROM memory_files').all() as Array<{ id: number; path: string }>;
    const remove = this.db.transaction((id: number) => this.deleteDocumentById(id));
    let deleted = 0;
    for (const row of rows) {
      if (!availablePaths.has(row.path)) {
        remove(row.id);
        deleted += 1;
      }
    }
    return deleted;
  }

  listDocuments(): IndexedVaultDocument[] {
    const rows = this.db.prepare('SELECT * FROM memory_files ORDER BY path COLLATE BINARY').all() as FileRow[];
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      title: row.title,
      description: row.description,
      tags: parseTags(row.tags_json),
      contentHash: row.content_hash,
      modifiedAt: row.modified_at,
    }));
  }

  searchKeyword(matchExpression: string, limit: number, filter: VaultPathFilter = {}): RankedChunkId[] {
    if (!matchExpression) return [];
    try {
      const pathFilter = this.pathFilterSql(filter, 'f');
      const rows = this.db.prepare(`
        SELECT memory_chunks_fts.rowid AS chunk_id, bm25(memory_chunks_fts, 4.0, 2.5, 1.5, 1.0) AS rank
        FROM memory_chunks_fts
        JOIN memory_chunks c ON c.id = memory_chunks_fts.rowid
        JOIN memory_files f ON f.id = c.file_id
        WHERE memory_chunks_fts MATCH ?
          ${pathFilter.sql}
        ORDER BY rank ASC
        LIMIT ?
      `).all(matchExpression, ...pathFilter.values, limit) as Array<{ chunk_id: number; rank: number }>;
      return rows.map((row) => ({ chunkId: row.chunk_id, rank: row.rank }));
    } catch (error) {
      throw new Error(`Keyword search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  searchVector(vector: number[], limit: number, filter: VaultPathFilter = {}): RankedChunkId[] {
    if (!vector.length) return [];
    const embedding = new Float32Array(vector);
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const pathFilter = this.pathFilterSql(filter, 'f');
    const rows = this.db.prepare(`
      WITH nearest AS (
        SELECT rowid AS chunk_id, distance
        FROM memory_vectors
        WHERE embedding MATCH ?
          AND rowid IN (
            SELECT c.id FROM memory_chunks c
            JOIN memory_files f ON f.id = c.file_id
            WHERE 1 = 1 ${pathFilter.sql}
          )
        ORDER BY distance ASC
        LIMIT ?
      )
      SELECT v.chunk_id, v.distance
      FROM nearest v
      JOIN memory_chunks c ON c.id = v.chunk_id
      JOIN memory_files f ON f.id = c.file_id
      ORDER BY v.distance ASC
      LIMIT ?
    `).all(buffer, ...pathFilter.values, Math.min(10_000, Math.max(limit, limit * 8)), limit) as Array<{ chunk_id: number; distance: number }>;
    return rows.map((row, index) => ({ chunkId: row.chunk_id, rank: index + 1, distance: row.distance }));
  }

  searchFileProfiles(vector: number[], limit: number, filter: VaultPathFilter = {}): RankedFileId[] {
    if (!vector.length) return [];
    const embedding = new Float32Array(vector);
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const pathFilter = this.pathFilterSql(filter, 'f');
    const rows = this.db.prepare(`
      WITH nearest AS (
        SELECT rowid AS file_id, distance
        FROM memory_file_vectors
        WHERE embedding MATCH ?
          AND rowid IN (
            SELECT f.id FROM memory_files f WHERE 1 = 1 ${pathFilter.sql}
          )
        ORDER BY distance ASC
        LIMIT ?
      )
      SELECT v.file_id, v.distance
      FROM nearest v
      JOIN memory_files f ON f.id = v.file_id
      ORDER BY v.distance ASC
      LIMIT ?
    `).all(buffer, ...pathFilter.values, Math.min(10_000, Math.max(limit, limit * 8)), limit) as Array<{ file_id: number; distance: number }>;
    return rows.map((row, index) => ({ fileId: row.file_id, rank: index + 1, distance: row.distance }));
  }

  getFirstChunks(fileIds: number[]): RetrievedChunk[] {
    if (fileIds.length === 0) return [];
    const placeholders = fileIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT c.id AS chunk_id, c.chunk_index, c.content, f.id AS file_id,
        f.path, f.title, f.description, f.tags_json
      FROM memory_files f
      JOIN memory_chunks c ON c.id = (
        SELECT c2.id FROM memory_chunks c2 WHERE c2.file_id = f.id ORDER BY c2.chunk_index LIMIT 1
      )
      WHERE f.id IN (${placeholders})
    `).all(...fileIds) as Array<{
      chunk_id: number; chunk_index: number; content: string; file_id: number;
      path: string; title: string; description: string; tags_json: string;
    }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      fileId: row.file_id,
      path: row.path,
      title: row.title,
      description: row.description,
      tags: parseTags(row.tags_json),
    }));
  }

  getChunks(ids: number[]): RetrievedChunk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT c.id AS chunk_id, c.chunk_index, c.content, f.id AS file_id,
        f.path, f.title, f.description, f.tags_json
      FROM memory_chunks c
      JOIN memory_files f ON f.id = c.file_id
      WHERE c.id IN (${placeholders})
    `).all(...ids) as Array<{
      chunk_id: number;
      chunk_index: number;
      content: string;
      file_id: number;
      path: string;
      title: string;
      description: string;
      tags_json: string;
    }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      fileId: row.file_id,
      path: row.path,
      title: row.title,
      description: row.description,
      tags: parseTags(row.tags_json),
    }));
  }

  close(): void {
    this.db.close();
  }

  private getMetadata(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM memory_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setMetadata(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO memory_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private pathFilterSql(filter: VaultPathFilter, alias: string): { sql: string; values: Array<string | number> } {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    const appendPrefixes = (prefixes: string[] | undefined, excluded: boolean): void => {
      if (!prefixes?.length) return;
      const matches: string[] = [];
      for (const rawPrefix of prefixes) {
        const prefix = rawPrefix.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
        if (!prefix) continue;
        matches.push(`(${alias}.path = ? OR substr(${alias}.path, 1, ?) = ?)`);
        values.push(prefix, prefix.length + 1, `${prefix}/`);
      }
      if (matches.length) clauses.push(excluded ? `AND NOT (${matches.join(' OR ')})` : `AND (${matches.join(' OR ')})`);
    };
    appendPrefixes(filter.includePrefixes, false);
    appendPrefixes(filter.excludePrefixes, true);
    return { sql: clauses.join('\n'), values };
  }

  private deleteDocumentById(fileId: number): void {
    this.db.prepare('DELETE FROM memory_file_vectors WHERE rowid = ?').run(BigInt(fileId));
    const chunks = this.db.prepare('SELECT id FROM memory_chunks WHERE file_id = ?').all(fileId) as Array<{ id: number }>;
    for (const { id } of chunks) {
      this.db.prepare('DELETE FROM memory_chunks_fts WHERE rowid = ?').run(id);
      this.db.prepare('DELETE FROM memory_vectors WHERE rowid = ?').run(BigInt(id));
    }
    this.db.prepare('DELETE FROM memory_chunks WHERE file_id = ?').run(fileId);
    this.db.prepare('DELETE FROM memory_files WHERE id = ?').run(fileId);
  }
}
