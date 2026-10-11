import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { webSearch } from './web-search.js';
import { webRead, fetchAndConvertUrl } from './web-read.js';

test('web research tools (free, location-aware, vault-isolated)', async (t) => {
  await t.test('validates webSearch input schema constraints', () => {
    const schema = webSearch.inputSchema as z.ZodType;
    assert.equal(schema.safeParse({ query: '' }).success, false);
    assert.equal(schema.safeParse({ query: 'car buying checklist' }).success, true);
    assert.equal(schema.safeParse({ query: 'car', maxResults: 0 }).success, false);
    assert.equal(schema.safeParse({ query: 'car', maxResults: 15 }).success, false);
    assert.equal((schema.parse({ query: 'car' }) as { maxResults: number }).maxResults, 5);
  });

  await t.test('validates webRead input schema constraints', () => {
    const schema = webRead.inputSchema as z.ZodType;
    assert.equal(schema.safeParse({ url: 'not-a-url' }).success, false);
    assert.equal(schema.safeParse({ url: 'https://example.com' }).success, true);
    assert.equal((schema.parse({ url: 'https://example.com' }) as { maxCharacters: number }).maxCharacters, 12_000);
  });

  await t.test('fetches and converts HTML into clean readable text without script/nav clutter', async () => {
    // Test conversion logic on real sample HTML
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Car Buying Guide 2026</title><style>body { color: red; }</style></head>
        <body>
          <nav><a href="/home">Home</a><a href="/about">About</a></nav>
          <header><h1>Site Header</h1></header>
          <main>
            <h2>Step 1: Check Financing</h2>
            <p>Compare pre-approved loan interest rates before visiting any dealership.</p>
            <script>console.log("tracking code");</script>
          </main>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    // Intercept fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(sampleHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });

    try {
      const result = await fetchAndConvertUrl('https://example.com/guide', 5000);
      assert.equal(result.title, 'Car Buying Guide 2026');
      assert.match(result.content, /Step 1: Check Financing/i);
      assert.match(result.content, /Compare pre-approved loan interest rates/);
      assert.doesNotMatch(result.content, /tracking code/);
      assert.doesNotMatch(result.content, /Site Header/);
      assert.doesNotMatch(result.content, /Copyright 2026/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('truncates oversized web page text cleanly at requested limit', async () => {
    const bigHtml = `<html><head><title>Big</title></head><body><p>${'Car details '.repeat(200)}</p></body></html>`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(bigHtml, { status: 200 });

    try {
      const result = await fetchAndConvertUrl('https://example.com/big', 200);
      assert.equal(result.truncated, true);
      assert.ok(result.content.includes('[Content truncated at 200 characters]'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
