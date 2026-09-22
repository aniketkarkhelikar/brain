import dotenv from 'dotenv';

dotenv.config();

const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://172.25.128.20:11434/api').replace(/\/+$/, '');
const activeModel = process.env.ACTIVE_MODEL || 'ollama:qwen2.5:14b';
const [provider, ...modelParts] = activeModel.split(':');
const modelName = modelParts.join(':');

if (provider !== 'ollama' || !modelName) {
  console.error('Connection check currently supports ACTIVE_MODEL=ollama:<model>.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(new URL('tags', `${baseUrl}/`), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);

    const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const models = body.models ?? [];
    const available = models.some((model) => model.name === modelName || model.model === modelName);
    console.log(`Ollama API reachable: yes`);
    console.log(`Configured model available (${modelName}): ${available ? 'yes' : 'no'}`);
    if (!available) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'request timed out'
      : error instanceof Error && error.message.startsWith('Ollama returned HTTP ')
        ? error.message
        : 'could not connect to the configured Ollama API';
    console.error(`Ollama API reachable: no (${message}).`);
    process.exitCode = 1;
  }
}
