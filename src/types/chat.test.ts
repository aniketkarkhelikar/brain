import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatSourcesFromToolResults, normalizeChatSources } from './chat.js';

describe('chat source trail', () => {
  it('collects public search results and marks pages read as verified', () => {
    const sources = chatSourcesFromToolResults([
      { toolName: 'webSearch', output: { success: true, results: [
        { title: 'Official guidance', url: 'https://example.gov/guide', snippet: 'Search excerpt.' },
        { title: 'Unsafe result', url: 'javascript:alert(1)', snippet: 'Ignore.' },
      ] } },
      { toolName: 'webRead', output: { success: true, title: 'Official guidance', url: 'https://example.gov/guide', content: 'Verified page.' } },
      { toolName: 'webSearch', output: { success: false, error: 'Provider returned an anti-bot challenge.' } },
      { toolName: 'vaultSearch', output: { success: true, results: [
        { title: 'Saved preference', path: 'Personal/preferences.md' },
      ] } },
      { toolName: 'skillLoad', output: { success: true, name: 'property-advisor' } },
    ]);

    assert.equal(sources.length, 1);
    assert.equal(sources[0].verified, true);
    assert.equal(sources[0].kind, 'web');
    assert.equal(sources[0].url, 'https://example.gov/guide');
  });

  it('rejects unsafe links and paths while preserving distinct safe sources', () => {
    const sources = normalizeChatSources([
      { kind: 'web', title: 'bad', url: 'file:///etc/passwd' },
      { kind: 'web', title: 'credentialed', url: 'https://user:secret@example.gov/' },
      { kind: 'memory', title: 'escape', path: '../secret.md' },
      { kind: 'memory', title: 'Saved note', path: 'Projects/Saved.md' },
    ]);
    assert.deepEqual(sources, [{ kind: 'memory', title: 'Saved note', path: 'Projects/Saved.md' }]);
  });
});
