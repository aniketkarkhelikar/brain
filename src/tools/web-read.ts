/**
 * web-read.ts — Fetch and convert web page content into clean, readable text.
 * Uses html-to-text to strip scripts, styles, headers, and footers.
 * IMPORTANT: Content is returned into conversation memory ONLY.
 * Nothing from web scraping is saved to the vault.
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { convert } from 'html-to-text';

const webReadSchema = z.object({
  url: z.string().url().describe('The full web URL to fetch and read, e.g. "https://example.com/article"'),
  maxCharacters: z.number().int().min(500).max(30_000).default(12_000).describe('Maximum length of extracted text in characters (default 12,000)'),
});

type WebReadInput = z.infer<typeof webReadSchema>;

type WebReadOutput =
  | { success: true; url: string; title: string; content: string; truncated: boolean }
  | { success: false; url: string; error: string };

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || 'Untitled web page';
}

export async function fetchAndConvertUrl(url: string, maxCharacters = 12_000): Promise<{ title: string; content: string; truncated: boolean }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const title = extractHtmlTitle(html);

  const cleanText = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'noscript', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'header', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'aside', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });

  const normalized = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  const truncated = normalized.length > maxCharacters;
  const content = truncated ? `${normalized.slice(0, maxCharacters)}\n\n[Content truncated at ${maxCharacters} characters]` : normalized;

  return { title, content, truncated };
}


export const webRead: Tool<WebReadInput, WebReadOutput> = tool({
  description: 'Fetch and extract the readable text of a specific web URL. Strips out navigation, scripts, ads, and footers. Results are returned into conversation memory for synthesis only and are NEVER written to the vault.',
  inputSchema: webReadSchema,
  execute: async ({ url, maxCharacters = 12_000 }) => {
    try {
      const result = await fetchAndConvertUrl(url, maxCharacters);
      return {
        success: true,
        url,
        title: result.title,
        content: result.content,
        truncated: result.truncated,
      };
    } catch (error) {
      return {
        success: false,
        url,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
