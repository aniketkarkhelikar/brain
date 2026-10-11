/**
 * web-search.ts — 100% Free, Zero-API-Key Web Search via DuckDuckGo.
 * Automatically injects user location context (country/city) when relevant.
 * IMPORTANT: Search results are returned into model working memory ONLY.
 * Nothing from web searches is written to the vault.
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { formatLocationContext, getUserLocation } from '../utils/location.js';

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

const webSearchSchema = z.object({
  query: z.string().min(1).max(300).describe('Search query to look up on the live web'),
  locationBias: z.string().optional().describe('Optional explicit geographical location to scope the query (e.g. city, state, or country)'),
  useLocation: z.boolean().default(false).describe('Whether to automatically bias results with the user local geographical context'),
  maxResults: z.number().int().min(1).max(10).default(5).describe('Maximum number of search results to return (default 5)'),
});

type WebSearchInput = z.infer<typeof webSearchSchema>;

type WebSearchOutput =
  | { success: true; query: string; locationUsed?: string; results: WebSearchResultItem[] }
  | { success: false; query: string; error: string };

function decodeDdgUrl(rawUrl: string): string {
  try {
    if (rawUrl.includes('uddg=')) {
      const match = rawUrl.match(/[?&]uddg=([^&]+)/);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
    if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches DuckDuckGo HTML endpoint without any API keys.
 */
export async function performDdgSearch(
  query: string,
  maxResults = 5,
): Promise<WebSearchResultItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(9_000),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP status ${response.status}`);
  }

  const html = await response.text();
  const results: WebSearchResultItem[] = [];

  const titleRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;

  const titles: Array<{ url: string; title: string }> = [];
  let titleMatch: RegExpExecArray | null;
  while ((titleMatch = titleRegex.exec(html)) !== null) {
    titles.push({
      url: decodeDdgUrl(titleMatch[1]),
      title: stripHtml(titleMatch[2]),
    });
  }

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(snippetMatch[1]));
  }

  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    const item = titles[i];
    if (item.title && item.url) {
      results.push({
        title: item.title,
        url: item.url,
        snippet: snippets[i] || '',
      });
    }
  }

  // Fallback to Instant Answer API if HTML returned 0 items
  if (results.length === 0) {
    const apiFallbackUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    try {
      const apiResp = await fetch(apiFallbackUrl, { signal: AbortSignal.timeout(5_000) });
      if (apiResp.ok) {
        const json = await apiResp.json() as Record<string, unknown>;
        if (typeof json.AbstractText === 'string' && json.AbstractText) {
          results.push({
            title: typeof json.Heading === 'string' ? json.Heading : query,
            url: typeof json.AbstractURL === 'string' ? json.AbstractURL : '',
            snippet: json.AbstractText,
          });
        }
      }
    } catch {
      // Ignore API fallback error
    }
  }

  return results;
}

export const webSearch: Tool<WebSearchInput, WebSearchOutput> = tool({
  description: 'Search the live web using free DuckDuckGo search. Automatically incorporates user location when appropriate. Results are returned into conversation memory for synthesis only and are NEVER written to the vault.',
  inputSchema: webSearchSchema,
  execute: async ({ query, locationBias, useLocation = false, maxResults = 5 }) => {
    try {
      let finalQuery = query.trim();
      let locationUsed: string | undefined;

      if (locationBias && locationBias.trim()) {
        const bias = locationBias.trim();
        if (!finalQuery.toLowerCase().includes(bias.toLowerCase())) {
          finalQuery = `${finalQuery} ${bias}`;
          locationUsed = bias;
        }
      } else if (useLocation) {
        const loc = await getUserLocation();
        const locContext = formatLocationContext(loc);
        const queryLower = finalQuery.toLowerCase();

        // Check if query does not already mention country or city
        const hasLocationMention =
          (loc.country && queryLower.includes(loc.country.toLowerCase())) ||
          (loc.city && queryLower.includes(loc.city.toLowerCase()));

        if (!hasLocationMention && loc.country && loc.country !== 'Unknown location') {
          finalQuery = `${finalQuery} ${loc.country}`;
          locationUsed = locContext;
        }
      }


      const results = await performDdgSearch(finalQuery, maxResults);
      return {
        success: true,
        query: finalQuery,
        locationUsed,
        results,
      };
    } catch (error) {
      return {
        success: false,
        query,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
