# brain

Local-first AI Second Brain. The TypeScript agent uses the Vercel AI SDK with Ollama on `lab52` and a Markdown vault in `vault/`.

The CLI streams responses from the configured Ollama model and saves complete conversation/tool history to `state/sessions.sqlite` (ignored by Git). Set `VAULT_PATH`, `BRAIN_SESSION_DB`, or `BRAIN_SESSION_ID` to use another vault, database, or initial session.

```sh
npm start
```

CLI commands: `/new [name]`, `/sessions`, `/use <id>`, `/reset`, and `/exit`. On its first run, the CLI resumes the vault's onboarding interview until `BOOTSTRAP.md` is removed. Store private calendar URLs in the local `.env` file, not in onboarding answers.

The vault tools support read, write, keyword search, and directory listing. Run `npm test` for automated checks, `npm run test:connection` to check the configured Ollama model, and `npm run test:agent` for live agent checks using a temporary vault.
