import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getLanguageModel } from './providers.js';

describe('model providers', () => {
  it('requires an OpenAI API key when OpenAI is selected', () => {
    const originalModel = process.env.ACTIVE_MODEL;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.ACTIVE_MODEL = 'openai:gpt-4.1-mini';
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(() => getLanguageModel(), /OPENAI_API_KEY/);
    } finally {
      if (originalModel === undefined) delete process.env.ACTIVE_MODEL;
      else process.env.ACTIVE_MODEL = originalModel;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('constructs the selected OpenAI language model from runtime credentials', () => {
    const originalModel = process.env.ACTIVE_MODEL;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.ACTIVE_MODEL = 'openai:gpt-4.1-mini';
    process.env.OPENAI_API_KEY = 'test-key';
    try {
      const model = getLanguageModel();
      assert.equal(typeof model, 'object');
    } finally {
      if (originalModel === undefined) delete process.env.ACTIVE_MODEL;
      else process.env.ACTIVE_MODEL = originalModel;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
