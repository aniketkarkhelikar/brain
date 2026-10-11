/** Public web search. Search terms are transient and results are never persisted. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { fetchSafePage, type SafePageOptions } from './web-read.js';
import { sanitizeUntrustedContent } from '../security/sanitizer.js';

export type WebSearchResultItem = { title: string; url: string; snippet: string };
type WebSearchInput = { query: string; maxResults: number };
type WebSearchOutput = { success: true; query: string; results: WebSearchResultItem[] } | { success: false; query: string; error: string };

function decodeDdgUrl(raw: string): string {
  try {
    const wrapped = new URL(raw.startsWith('//') ? `https:${raw}` : raw, 'https://duckduckgo.com');
    const redirect = wrapped.searchParams.get('uddg');
    return redirect || wrapped.href;
  } catch {
    return raw;
  }
}

function decodeBingUrl(raw: string): string {
  const unescaped = decodeEntities(raw.replaceAll('&amp;', '&'));
  try {
    const wrapped = new URL(unescaped);
    if (!wrapped.hostname.endsWith('bing.com') || wrapped.pathname !== '/ck/a') return unescaped;
    const encoded = wrapped.searchParams.get('u');
    if (!encoded?.startsWith('a1')) return unescaped;
    const target = Buffer.from(encoded.slice(2), 'base64url').toString('utf8');
    const decoded = new URL(target);
    return ['http:', 'https:'].includes(decoded.protocol) && !decoded.username && !decoded.password ? decoded.href : unescaped;
  } catch {
    return unescaped;
  }
}

function stripHtml(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp|nbsp);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()] || whole;
  });
}

function safeResult(value: unknown): WebSearchResultItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as { title?: unknown; url?: unknown; description?: unknown };
  if (typeof item.title !== 'string' || typeof item.url !== 'string') return undefined;
  try {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return {
      title: sanitizeUntrustedContent(item.title).text,
      url: url.href,
      snippet: typeof item.description === 'string' ? sanitizeUntrustedContent(item.description).text : '',
    };
  } catch {
    return undefined;
  }
}

export function parseBraveSearchResponse(raw: string, maxResults = 5): WebSearchResultItem[] {
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error('Brave Search returned invalid JSON.'); }
  if (!payload || typeof payload !== 'object') throw new Error('Brave Search returned an invalid response.');
  const web = (payload as { web?: { results?: unknown } }).web;
  if (!Array.isArray(web?.results)) throw new Error('Brave Search response did not include web results.');
  return web.results.map(safeResult).filter((item): item is WebSearchResultItem => Boolean(item)).slice(0, maxResults);
}

export function parseExaSearchResponse(raw: string, maxResults = 5): WebSearchResultItem[] {
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error('Exa Search returned invalid JSON.'); }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('Exa Search response did not include web results.');
  }
  return (payload as { results: unknown[] }).results.map((value) => {
    if (!value || typeof value !== 'object') return undefined;
    const item = value as { title?: unknown; url?: unknown; highlights?: unknown; publishedDate?: unknown };
    const highlights = Array.isArray(item.highlights) ? item.highlights.filter((entry): entry is string => typeof entry === 'string') : [];
    const date = typeof item.publishedDate === 'string' ? 'Published: ' + item.publishedDate + '. ' : '';
    return safeResult({
      title: item.title,
      url: item.url,
      description: date + highlights.join(' '),
    });
  }).filter((item): item is WebSearchResultItem => Boolean(item)).slice(0, maxResults);
}

export async function performExaSearch(
  query: string,
  maxResults = 5,
  apiKey = process.env.EXA_API_KEY,
  fetcher: typeof fetch = fetch,
): Promise<WebSearchResultItem[]> {
  if (!apiKey?.trim()) throw new Error('Exa Search is not configured. Set EXA_API_KEY in the process environment.');
  let response: Response;
  try {
    response = await fetcher('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim() },
      body: JSON.stringify({ query, type: 'auto', contents: { highlights: true } }),
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('Exa Search request failed before a response was received.');
  }
  if (!response.ok) throw new Error('Exa Search returned HTTP ' + response.status + '.');
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('Exa Search did not return JSON results.');
  }
  return parseExaSearchResponse(await response.text(), maxResults);
}

export function parseDdgHtml(html: string, maxResults = 5): WebSearchResultItem[] {
  if (/anomaly-modal|anomaly\.js|automated requests|select all squares|bot challenge/i.test(html)) {
    throw new Error('DuckDuckGo returned an anti-bot challenge instead of search results.');
  }
  const titles: Array<{ title: string; url: string }> = [];
  for (const match of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decodeDdgUrl(match[1]);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
      titles.push({ title: stripHtml(match[2]), url: parsed.href });
    } catch {
      // Ignore malformed links from the search page.
    }
  }
  const snippets = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => stripHtml(match[1]));
  return titles.slice(0, maxResults).filter((item) => item.title).map((item, index) => ({
    ...item,
    title: sanitizeUntrustedContent(item.title).text,
    snippet: sanitizeUntrustedContent(snippets[index] || '').text,
  }));
}

export function parseBingSearchHtml(html: string, maxResults = 5): WebSearchResultItem[] {
  if (/captcha|verify you are human|unusual traffic/i.test(html) && !/class="b_algo"/i.test(html)) {
    throw new Error('Bing returned an anti-bot challenge instead of search results.');
  }
  const results: WebSearchResultItem[] = [];
  const blocks = html.matchAll(/<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi);
  for (const block of blocks) {
    const contents = block[1];
    const heading = contents.match(/<h2\b[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!heading) continue;
    const caption = contents.match(/<div\b[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const description = caption.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
    const result = safeResult({ title: stripHtml(heading[2]), url: decodeBingUrl(heading[1]), description: stripHtml(description) });
    if (result) results.push(result);
    if (results.length >= maxResults) break;
  }
  return results;
}

function rejectSensitiveQuery(query: string): void {
  const patterns = [
    /\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/i,
    /\b[A-Z]{5}\d{4}[A-Z]\b/i,
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    /(?:\+?\d[\d\s().-]{8,}\d)/,
    /(?:₹|\bINR\s*)\s*[\d,]+(?:\.\d+)?/i,
    /\b\d+(?:\.\d+)?\s*(?:lakh|lakhs|crore|crores)\b/i,
    /\bmy\s+(?:salary|income|bank|account|address|phone|email|passport|aadhar|aadhaar)\b/i,
  ];
  if (patterns.some((pattern) => pattern.test(query))) {
    throw new Error('This query appears to contain personal or financial details. Rephrase it using generic public terms.');
  }
}

export async function performDdgSearch(query: string, maxResults = 5): Promise<WebSearchResultItem[]> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchSafePage(endpoint);
  if (response.status < 200 || response.status >= 300) throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
  if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.contentType)) throw new Error('DuckDuckGo did not return an HTML results page.');
  const results = parseDdgHtml(response.body, maxResults);
  if (!results.length && !/no (?:web )?results|no results found|there aren.t any results/i.test(response.body)) {
    throw new Error('DuckDuckGo returned a page without parseable search results.');
  }
  return results;
}

export async function performBraveSearch(
  query: string,
  maxResults = 5,
  apiKey = process.env.BRAVE_SEARCH_API_KEY,
  fetcher: typeof fetchSafePage = fetchSafePage,
): Promise<WebSearchResultItem[]> {
  if (!apiKey?.trim()) throw new Error('Brave Search is not configured. Set BRAVE_SEARCH_API_KEY in the local .env file.');
  const country = (process.env.WEB_SEARCH_COUNTRY || 'IN').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('WEB_SEARCH_COUNTRY must be a two-letter country code.');
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('count', String(Math.min(20, Math.max(1, maxResults))));
  endpoint.searchParams.set('country', country);
  endpoint.searchParams.set('search_lang', 'en');
  const options: SafePageOptions = { accept: 'application/json', subscriptionToken: apiKey.trim() };
  const response = await fetcher(endpoint.href, options);
  if (!/^application\/json(?:;|$)/i.test(response.contentType)) throw new Error('Brave Search did not return JSON results.');
  return parseBraveSearchResponse(response.body, maxResults);
}

export async function performBingSearch(
  query: string,
  maxResults = 5,
  fetcher: typeof fetchSafePage = fetchSafePage,
): Promise<WebSearchResultItem[]> {
  const endpoint = new URL('https://www.bing.com/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('count', '20');
  const country = (process.env.WEB_SEARCH_COUNTRY || 'IN').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('WEB_SEARCH_COUNTRY must be a two-letter country code.');
  endpoint.searchParams.set('mkt', `en-${country}`);
  endpoint.searchParams.set('setlang', 'en');
  const response = await fetcher(endpoint.href);
  if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.contentType)) throw new Error('Bing did not return an HTML results page.');
  const results = rankSearchResults(query, parseBingSearchHtml(response.body, 20)).slice(0, maxResults);
  if (!results.length) throw new Error('Bing returned no results matching the query terms.');
  return results;
}

function rankSearchResults(query: string, results: WebSearchResultItem[]): WebSearchResultItem[] {
  const ignored = new Set(['about', 'after', 'best', 'from', 'guide', 'how', 'into', 'latest', 'more', 'news', 'official', 'page', 'search', 'site', 'the', 'what', 'when', 'where', 'which', 'with', 'www', 'com', 'org', 'net']);
  const wanted = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter((word) => word.length > 2 && !ignored.has(word));
  return results.map((result, index) => {
    const searchable = `${result.title} ${result.url} ${result.snippet}`.toLocaleLowerCase();
    const score = wanted.reduce((sum, word) => sum + (searchable.includes(word) ? (result.title.toLocaleLowerCase().includes(word) ? 3 : result.url.toLocaleLowerCase().includes(word) ? 2 : 1) : 0), 0);
    return { result, index, score };
  }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score || left.index - right.index).map(({ result }) => result);
}

async function performFallbackSearch(query: string, maxResults: number, priorErrors: string[] = []): Promise<WebSearchResultItem[]> {
  const errors: string[] = [...priorErrors];
  for (const [name, provider] of [['DuckDuckGo', performDdgSearch], ['Bing', performBingSearch]] as const) {
    try {
      const results = await provider(query, maxResults);
      if (results.length) return results;
      errors.push(`${name}: returned no results`);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Web search failed (${errors.join('; ')}).`);
}

export async function performWebSearch(query: string, maxResults = 5): Promise<WebSearchResultItem[]> {
  const safeQuery = query.trim();
  if (!safeQuery) throw new Error('Enter a search query.');
  rejectSensitiveQuery(safeQuery);
  const providerErrors: string[] = [];
  const exaApiKey = process.env.EXA_API_KEY;
  if (exaApiKey?.trim()) {
    try {
      const results = await performExaSearch(safeQuery, maxResults, exaApiKey);
      if (results.length) return results;
      providerErrors.push('Exa Search: returned no results');
    } catch (error) {
      providerErrors.push(`Exa Search: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (apiKey?.trim()) {
    try {
      const results = await performBraveSearch(safeQuery, maxResults, apiKey);
      if (results.length) return results;
      providerErrors.push('Brave Search: returned no results');
    } catch (error) {
      providerErrors.push(`Brave Search: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }
  return performFallbackSearch(safeQuery, maxResults, providerErrors);
}

export const webSearch: Tool<WebSearchInput, WebSearchOutput> = tool({
  description: 'Search the public web for candidate sources. Search titles and snippets are leads only, not verified evidence; for factual research, open relevant result pages with webRead before relying on them. Use generic terms only; never include personal vault details, identifiers, or private documents. Results stay in the conversation and are not saved to the vault.',
  inputSchema: z.object({
    query: z.string().min(1).max(300),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    try {
      const safeQuery = query.trim();
      if (!safeQuery) throw new Error('Enter a search query.');
      return { success: true, query: safeQuery, results: await performWebSearch(safeQuery, maxResults) };
    } catch (error) {
      return { success: false, query, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
