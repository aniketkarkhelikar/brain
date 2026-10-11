import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getUserLocation, formatLocationContext, type UserLocation } from './location.js';

test('auto location utility', async (t) => {
  const temporaryState = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-loc-test-'));
  const oldState = process.env.STATE_PATH;
  process.env.STATE_PATH = temporaryState;

  t.after(async () => {
    if (oldState !== undefined) process.env.STATE_PATH = oldState;
    else delete process.env.STATE_PATH;
    await fs.rm(temporaryState, { recursive: true, force: true });
  });

  await t.test('formats location context cleanly', () => {
    const loc: UserLocation = {
      city: 'Pune',
      region: 'Maharashtra',
      country: 'India',
      source: 'ip',
    };
    assert.equal(formatLocationContext(loc), 'Pune, Maharashtra, India');

    const partial: UserLocation = {
      country: 'India',
      source: 'timezone',
    };
    assert.equal(formatLocationContext(partial), 'India');
  });

  await t.test('reads cached location if valid within TTL', async () => {
    const cacheFile = path.join(temporaryState, 'location.json');
    const mockLocation: UserLocation = {
      city: 'Mumbai',
      region: 'Maharashtra',
      country: 'India',
      source: 'ip',
    };

    await fs.writeFile(
      cacheFile,
      JSON.stringify({ cachedAt: Date.now(), location: mockLocation }),
      'utf8',
    );

    const result = await getUserLocation(false);
    assert.equal(result.city, 'Mumbai');
    assert.equal(result.country, 'India');
  });
});
