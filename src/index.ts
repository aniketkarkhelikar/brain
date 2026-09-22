import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { ModelMessage } from 'ai';
import { agentStream } from './agent.js';
import { runCli } from './cli.js';
import { SessionStore } from './memory/session.js';

async function main(): Promise<void> {
  const vaultPath = path.resolve(process.env.VAULT_PATH || './vault');
  const sessionStore = new SessionStore();
  const readline = createInterface({ input: stdin, output: stdout, terminal: true });
  const model = process.env.ACTIVE_MODEL || 'ollama:qwen2.5:14b';

  stdout.write(`🧠 Second Brain Agent v1.0 (model: ${model})\n`);
  stdout.write(`Vault: ${vaultPath}\nLoading chat history... ✓\n`);
  try {
    await runCli({
      vaultPath,
      store: sessionStore,
      ask: (prompt) => readline.question(prompt),
      write: (text) => stdout.write(text),
      initialSessionId: process.env.BRAIN_SESSION_ID,
      respond: async (prompt, history, onToken): Promise<ModelMessage[]> => {
        const result = await agentStream(prompt, history);
        for await (const token of result.textStream) onToken(token);
        return await result.responseMessages as ModelMessage[];
      },
    });
  } finally {
    readline.close();
    sessionStore.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Unable to start the Second Brain CLI: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
