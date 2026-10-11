/**
 * note-connector.ts — Semantic Note Connection Analyzer (Phase 2C)
 *
 * Discovers and synthesizes genuine conceptual relationships across vault notes,
 * projects, meetings, and ideas, explicitly filtering out operational audit/log noise.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { generateText } from 'ai';
import { getLanguageModel } from '../providers.js';

interface ContentNote {
  filePath: string;
  title: string;
  tags: string[];
  wikilinks: string[];
  content: string;
}

const EXCLUDED_FILES = new Set([
  'heartbeat.md',
  'bootstrap.md',
  'soul.md',
  'log.md',
  'index.md',
]);

export async function findNoteConnections(vaultPath: string): Promise<string> {
  const contentNotes: ContentNote[] = [];

  // 1. Walk vault directories to find content notes
  async function scanDir(currentDir: string, relativeDir = '') {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue; // skip hidden files like .git
      const fullPath = path.join(currentDir, entry);
      const relPath = path.join(relativeDir, entry);

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // Skip logs and daily audit folder for conceptual connection analysis
        if (entry.toLowerCase() === 'daily') continue;
        await scanDir(fullPath, relPath);
      } else if (entry.endsWith('.md')) {
        const baseName = entry.toLowerCase();
        if (EXCLUDED_FILES.has(baseName)) continue;

        try {
          const raw = await fs.readFile(fullPath, 'utf8');
          const parsed = matter(raw);
          const title = String(parsed.data.title || path.basename(entry, '.md').replace(/[-_]/g, ' '));
          const tags = Array.isArray(parsed.data.tags)
            ? parsed.data.tags.map(String)
            : typeof parsed.data.tags === 'string'
              ? parsed.data.tags.split(',').map((t: string) => t.trim())
              : [];

          // Extract [[wikilinks]]
          const wikilinks: string[] = [];
          const linkRegex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
          let match;
          while ((match = linkRegex.exec(parsed.content)) !== null) {
            wikilinks.push(match[1].trim());
          }

          contentNotes.push({
            filePath: relPath,
            title,
            tags,
            wikilinks,
            content: parsed.content.trim(),
          });
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  await scanDir(vaultPath);

  // Also read MEMORY.md if available for high-level project goals
  let memoryContent = '';
  try {
    memoryContent = await fs.readFile(path.join(vaultPath, 'MEMORY.md'), 'utf8');
  } catch {
    // optional
  }

  if (contentNotes.length === 0) {
    return [
      `### Vault Notes Overview`,
      `Your vault currently does not have compiled concept or project notes yet.`,
      `Most items are currently in your \`Inbox/\` awaiting compilation or in operational logs.`,
      `To start seeing rich connections:`,
      `- Add project notes or thoughts to your \`Inbox/\`.`,
      `- Run inbox ingestion or review queued items to compile them into your knowledge base.`,
    ].join('\n');
  }

  // 2. Format notes summary for the model
  const notesSummary = contentNotes
    .map((note) => {
      const snippet = note.content.slice(0, 400).replace(/\n+/g, ' ');
      return `- **[${note.title}]** (\`${note.filePath}\`)${note.tags.length ? ` [Tags: ${note.tags.join(', ')}]` : ''}${note.wikilinks.length ? ` [Links: ${note.wikilinks.join(', ')}]` : ''}\n  Summary: ${snippet}`;
    })
    .join('\n\n');

  // 3. Ask the model to synthesize semantic connections
  try {
    const model = getLanguageModel();
    const prompt = [
      `You are the Second Brain connection engine. Analyze the following content notes and identify key relationships, cross-cutting themes, and shared project concepts.`,
      '',
      memoryContent ? `High-Level Memory / Active Goals:\n${memoryContent}\n` : '',
      `Content Notes in Vault (${contentNotes.length} notes):\n${notesSummary}`,
      '',
      `Instructions:`,
      `1. Group related notes by meaningful thematic connections (e.g. Project Architecture, Vector Search & Retrieval, Infrastructure).`,
      `2. Explain HOW each note connects to the others (e.g. "Note A specifies database requirements, which connects directly to Note B's algorithm discussion").`,
      `3. Do NOT list raw file counts or audit logs. Focus on real human and technical knowledge.`,
      `4. Highlight any open loops or next logical steps.`,
    ].join('\n');

    const result = await generateText({
      model,
      prompt,
      temperature: 0.2,
    });

    return result.text;
  } catch (error) {
    // Graceful fallback if model is temporarily busy
    return [
      `### Identified Notes in Your Vault:`,
      ...contentNotes.map((n) => `- **${n.title}** (\`${n.filePath}\`)`),
      '',
      `Key connected themes: ${contentNotes.flatMap((n) => n.tags).filter(Boolean).join(', ') || 'AI Second Brain, Engineering'}`,
    ].join('\n');
  }
}
