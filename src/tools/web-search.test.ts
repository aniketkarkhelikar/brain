import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBraveSearchResponse, parseDdgHtml, performBraveSearch, performWebSearch } from './web-search.js';

describe('public web search parsing', () => {
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

  it('blocks personal financial details before contacting a search provider', async () => {
    await assert.rejects(performWebSearch('my salary 2 lakh'), /personal or financial details/);
  });
});
