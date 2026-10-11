import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBraveSearchResponse, parseExaSearchResponse, parseBingSearchHtml, parseDdgHtml, performBraveSearch, performBingSearch, performExaSearch, performWebSearch } from './web-search.js';

describe('public web search parsing', () => {
  it('parses Exa highlights, bounds local result count, and filters unsafe result URLs', () => {
    const payload = JSON.stringify({ results: [
      { title: 'First result', url: 'https://example.org/first', highlights: ['A grounded highlight.'], publishedDate: '2026-10-10' },
      { title: 'Unsafe', url: 'javascript:alert(1)', highlights: ['Ignored.'] },
      { title: 'Second result', url: 'https://example.org/second', highlights: ['Second highlight.'] },
    ] });
    assert.deepEqual(parseExaSearchResponse(payload, 1), [{
      title: 'First result',
      url: 'https://example.org/first',
      snippet: 'Published: 2026-10-10. A grounded highlight.',
    }]);
    assert.equal(parseExaSearchResponse(payload, 5).length, 2);
    assert.throws(() => parseExaSearchResponse('not-json'), /invalid JSON/);
  });

  it('sends Exa the canonical minimal search request with its key in a header', async () => {
    let requestedUrl = '';
    let requestedOptions: RequestInit | undefined;
    const fetcher = async (input: string | URL | Request, options?: RequestInit) => {
      requestedUrl = String(input);
      requestedOptions = options;
      return new Response(JSON.stringify({ results: [
        { title: 'Exa result', url: 'https://example.org/guide', highlights: ['Relevant source text.'] },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const results = await performExaSearch('public memory system practices', 4, 'test-secret', fetcher);
    assert.equal(requestedUrl, 'https://api.exa.ai/search');
    assert.equal(requestedOptions?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requestedOptions?.body)), {
      query: 'public memory system practices',
      type: 'auto',
      contents: { highlights: true },
    });
    assert.equal(new Headers(requestedOptions?.headers).get('x-api-key'), 'test-secret');
    assert.equal(results[0]?.snippet, 'Relevant source text.');
  });

  it('extracts bounded Brave API results and rejects unsafe result URLs', () => {
    const payload = JSON.stringify({ web: { results: [
      { title: 'Delhi property', url: 'https://example.gov.in/guide', description: 'Check title and registration.' },
      { title: 'Unsafe', url: 'javascript:alert(1)', description: 'Ignored' },
      { title: 'Second result', url: 'https://example.test/second', description: 'Public guide' },
    ] } });
    assert.deepEqual(parseBraveSearchResponse(payload, 1), [{
      title: 'Delhi property',
      url: 'https://example.gov.in/guide',
      snippet: 'Check title and registration.',
    }]);
    assert.equal(parseBraveSearchResponse(payload, 5).length, 2);
    assert.throws(() => parseBraveSearchResponse('not-json'), /invalid JSON/);
  });

  it('keeps the API key in the request header and sends a regional query', async () => {
    let requestedUrl = '';
    let requestedOptions: unknown;
    const fetcher = async (url: string, options?: { accept?: string; subscriptionToken?: string }) => {
      requestedUrl = url;
      requestedOptions = options;
      return { status: 200, finalUrl: url, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ web: { results: [] } }) };
    };
    await performBraveSearch('public property process', 4, 'test-secret', fetcher);
    const parsed = new URL(requestedUrl);
    assert.equal(parsed.searchParams.get('q'), 'public property process');
    assert.equal(parsed.searchParams.get('count'), '4');
    assert.equal(parsed.searchParams.get('country'), process.env.WEB_SEARCH_COUNTRY || 'IN');
    assert.deepEqual(requestedOptions, { accept: 'application/json', subscriptionToken: 'test-secret' });
    assert.equal(parsed.searchParams.has('token'), false);
  });

  it('recognizes DuckDuckGo anti-bot pages as failures, not empty results', () => {
    assert.throws(() => parseDdgHtml('<html><div class="anomaly-modal">Automated requests</div></html>'), /anti-bot challenge/);
    assert.deepEqual(parseDdgHtml('<html><a class="result__a" href="https://example.org/page">Result &amp; guide</a><a class="result__snippet">A snippet</a></html>'), [{
      title: 'Result & guide', url: 'https://example.org/page', snippet: 'A snippet',
    }]);
  });

  it('decodes Bing result redirects and keeps only safe public result URLs', () => {
    const encodedTarget = Buffer.from('https://developer.example.org/design').toString('base64url');
    const html = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1${encodedTarget}&amp;ntb=1">Design &amp; craft</a></h2><div class="b_caption"><p>Good design is clear.</p></div></li><li class="b_algo"><h2><a href="javascript:alert(1)">Unsafe</a></h2><div class="b_caption"><p>Ignore this.</p></div></li></ol>`;
    assert.deepEqual(parseBingSearchHtml(html, 5), [{
      title: 'Design & craft',
      url: 'https://developer.example.org/design',
      snippet: 'Good design is clear.',
    }]);
    assert.throws(() => parseBingSearchHtml('<html>Verify you are human</html>'), /anti-bot challenge/);
  });

  it('requests Bing HTML results with a bounded result count', async () => {
    let requestedUrl = '';
    const fetcher = async (url: string) => {
      requestedUrl = url;
      return {
        status: 200, finalUrl: url, contentType: 'text/html; charset=utf-8',
        body: '<li class="b_algo"><h2><a href="https://example.org/page">Public design principles</a></h2><div class="b_caption"><p>A snippet.</p></div></li>',
      };
    };
    const results = await performBingSearch('public design principles', 3, fetcher);
    const parsed = new URL(requestedUrl);
    assert.equal(parsed.searchParams.get('q'), 'public design principles');
    assert.equal(parsed.searchParams.get('count'), '20');
    assert.equal(parsed.searchParams.get('mkt'), `en-${process.env.WEB_SEARCH_COUNTRY || 'IN'}`);
    assert.equal(parsed.searchParams.get('setlang'), 'en');
    assert.equal(results[0]?.url, 'https://example.org/page');
  });

  it('does not report unrelated search results as a successful match', async () => {
    const fetcher = async (url: string) => ({
      status: 200, finalUrl: url, contentType: 'text/html; charset=utf-8',
      body: '<li class="b_algo"><h2><a href="https://example.org/random">A random page</a></h2><div class="b_caption"><p>Unrelated content.</p></div></li>',
    });
    await assert.rejects(performBingSearch('specialized apple guideline query', 5, fetcher), /no results matching the query terms/);
  });

  it('blocks personal financial details before contacting a search provider', async () => {
    await assert.rejects(performWebSearch('my salary 2 lakh'), /personal or financial details/);
  });
});
