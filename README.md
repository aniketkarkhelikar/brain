# brain

Local-first AI Second Brain. The TypeScript agent uses the Vercel AI SDK with Ollama on `lab52` and a Markdown vault in `vault/`.

Phase 3 provides vault read, write, keyword search, and directory listing tools. Run `npm test` for isolated vault-tool tests, `npm run test:connection` to check the configured Ollama model, and `npm run test:agent` for live agent checks using a temporary vault.
