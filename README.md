# brain

Local-first AI Second Brain. The TypeScript agent uses the Vercel AI SDK with Ollama and a Markdown vault. Run the browser app with `npm start` (default `http://127.0.0.1:4173`) or the terminal assistant with `npm run cli`.

The browser app saves conversation text to the local `state/sessions.sqlite`. Its local search index, lint report, memory-audit report, and Inbox recovery journals are in `state/` by default and ignored by Git. Tool calls are kept out of saved chat history. Configure `VAULT_PATH`, `BRAIN_SESSION_DB`, `BRAIN_MEMORY_DB`, `BRAIN_MEMORY_AUDIT_REPORT`, `VAULT_LINT_REPORT`, `UI_HOST`, or `UI_PORT` in `.env` as needed. Keep state paths outside the Obsidian vault so app metadata does not appear among your notes.

## Using an Obsidian vault

There is no Obsidian plugin or account connector. Set `VAULT_PATH` to the local folder that contains the Obsidian vault, then start the app. Brain reads and writes ordinary Markdown files in that folder; it does not connect to Obsidian Sync or read Obsidian account data.

- **Files read for every chat:** root `SOUL.md`, `USER.md`, `MEMORY.md`, and `daily/YYYY-MM-DD.md` for the current date when those files exist. Other notes are searched or opened only when relevant.
- **Files indexed for search:** nested, non-hidden `.md` files including `Archive/`, except root `index.md` (the catalog itself). The UI's Brain file list hides folders named exactly `Archive`; search can still return archived notes. The deterministic and AI audits also read archived Markdown as evidence, but never rewrite archive notes.
- **Ignored:** `.obsidian/`, other hidden folders/files, symbolic links, PDFs, images, audio, canvases, and other non-Markdown attachments. Their files remain untouched; links to attachments may remain as text in Markdown.
- **Files the app may create or update:** root `index.md` (generated file catalog, preserving its other sections); root `log.md` (append-only record of lint, audit, Inbox, and heartbeat actions); `daily/YYYY-MM-DD.md` (heartbeat entries); and topic notes selected while compiling Inbox Markdown. A processed Inbox source is moved to `Archive/Inbox/<original nested path>/<name>--<content-hash>.md`. Existing links to that Inbox source may be updated to its archived path. A safe memory correction replaces one exact current-state line and moves the old line verbatim into that same note's `Log` section.
- **Onboarding:** if the vault contains `BOOTSTRAP.md`, the first-run interview can update `SOUL.md` and `USER.md`, then remove `BOOTSTRAP.md` after completion. It does not run merely because `VAULT_PATH` points to a vault.

The model does not ingest the entire vault into every chat. Search returns candidate passages, and the agent can open relevant Markdown files on demand. The app never reads or changes `.obsidian` settings or binary attachments.

## Memory management and linting

The product treats **state** and **events** differently: a changing current value belongs once in `Current State` and is replaced when stronger evidence proves it changed; an event remains in history. The adapted `second-brain-audit` and `second-brain-fix` skills are in `skills/` and load automatically for matching requests. The audit compares claims in always-loaded files and explicit `Current State` sections with a bounded set of exact evidence candidates. Raw unprocessed Inbox captures do not become memory evidence until the Inbox compiler validates and archives them. Its report includes checked files, remaining coverage, and errors; a partial pass is never presented as a clean full-vault result.

A high-confidence contradiction is corrected automatically only when the exact target line appears once in `Current State`, the evidence quote appears exactly once in a scanned Markdown note, the quote contains an explicit valid ISO date newer than the old date, and the replacement value is copied from that quote. Unsupported or ambiguous claims remain in the Settings review list. Structural lint independently checks empty notes, links, orphans, and processed Inbox items; it does not guess whether a personal fact is true. Reports are in app-local `state/`; actions are appended to root `log.md`.

A local Chokidar watcher coalesces editor saves, watches nested Markdown, and ignores hidden paths, attachments, symlinks, `index.md`, and `log.md`. It compiles only changed Inbox captures; then the index, structural lint, and incremental AI memory audit refresh. Settings has two actions: **Run brain checks** (structural lint and AI memory audit together) and **Process Inbox**. The combined brain check runs daily at 03:30 by default. Inbox processing runs every 30 minutes from 08:00 through 22:30. Both use `HEARTBEAT_TIMEZONE` (default `Asia/Kolkata`) and run only while the local app or standalone heartbeat process is alive. Use either `npm start` or `npm run heartbeat`, not both, for recurring jobs.

The primary maintenance commands match the two UI actions: `npm run brain:check` runs both checks, and `npm run ingest` processes Inbox notes. The separate `npm run audit` and `npm run memory:audit` commands remain available for diagnostics. Schedule overrides: `BRAIN_CHECK_CRON`, `HEARTBEAT_CRON`, and `HEARTBEAT_TIMEZONE`. `VAULT_LINT_CRON` and `BRAIN_MEMORY_AUDIT_CRON` remain accepted as older aliases for the combined brain-check schedule.

The audit/fix workflow is based on the state/event model and evidence safeguards in [second-brain-audit](https://github.com/coleam00/skills/tree/main/.claude/skills/second-brain-audit) and [second-brain-fix](https://github.com/coleam00/skills/tree/main/.claude/skills/second-brain-fix), adapted to the app's local report and append-only action log. File watching uses [Chokidar](https://github.com/paulmillr/chokidar).

## Inbox, search, and skills

`npm run ingest` processes Markdown files in `Inbox/`, splits a mixed brain dump into topic actions, and applies changes only when destinations are clear. Updates are source-linked and journaled so interrupted work can resume without duplicate writes. Ambiguous or failed items stay in the Inbox review queue; `npm run ingest -- --retry-review` retries them. Existing current-state claims are superseded in place, with prior text preserved in `Log`.

Search combines exact keyword matching, semantic chunks, and per-file metadata. Changed Markdown is re-embedded incrementally. Root `index.md` lists each indexed note's filename, description, and relative path while preserving hand-maintained sections. The assistant has public web search and page reading; web queries should remain generic and external page text is untrusted. Set `BRAVE_SEARCH_API_KEY` for Brave Search; DuckDuckGo remains the no-key fallback. `WEB_SEARCH_COUNTRY` selects the search region (default `IN`). Add `skills/<skill-name>/SKILL.md` to make a local skill available on the next message, or set `SKILLS_PATH` to another folder. Connectors and cloud hosting are not implemented in this build.

## Verification commands

- `npm run typecheck` checks TypeScript.
- `npm test` runs automated checks.
- `npm run test:embeddings`, `npm run test:memory`, `npm run test:ingest`, `npm run test:connection`, and `npm run test:agent` perform live model checks with temporary data where applicable.
- `npm run index:vault` explicitly refreshes the index; searches also update changed files automatically.
