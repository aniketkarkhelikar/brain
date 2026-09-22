# AI Second Brain — Task Tracker

**Status:** Phases 1, 2 (local Qwen path), 3, and 8 complete; Phase 4 not started
**Model:** `qwen2.5:14b` on lab52 (`172.25.128.20`)  
**Interface:** CLI  
**Started:** 2026-09-23
**Checkpoint:** `cfe5354` (`check point 2`, Phase 3 baseline pushed to `origin/main`); Phase 8 is implemented and verified in the current working tree

**Verified stack:** Node.js 22, TypeScript 5.9, Vercel AI SDK 7.0.111

> The SDK research report contains older examples. For the installed AI SDK 7, use `inputSchema` for tools, `ModelMessage` for history, `stopWhen: isStepCount(n)` for loop limits, and `result.responseMessages` to retain all assistant/tool messages. `result.response.messages` only contains the final model call.

---

## Phase 1: Foundation — Vault Structure & Memory Layer
- [x] Create `package.json` with dependencies
- [x] Create `tsconfig.json`
- [x] Configure local `.env` with Ollama settings (ignored by Git)
- [x] Create vault directory structure, including the ignored email/archive data folders
- [x] Create `vault/SOUL.md` (agent identity)
- [x] Create `vault/USER.md` (user profile template)
- [x] Create `vault/MEMORY.md` (key facts store)
- [x] Create `vault/HEARTBEAT.md` (proactive checklist)
- [x] Create `vault/BOOTSTRAP.md` (onboarding wizard)
- [x] Create `vault/index.md` and `vault/log.md`
- [x] Install npm dependencies
- [x] **TEST:** Vault templates and directories are present/readable
- [x] **TEST:** Dependencies resolve with `npm ls --depth=0`

## Phase 2: Provider Registry & Core Agent Engine
- [x] Create `src/providers.ts` (Ollama → lab52 resolver with `num_ctx`)
- [x] Create `src/agent.ts` (Vercel AI SDK tool loop)
- [x] Create `src/tools/vault-read.ts`
- [x] Create `src/tools/vault-write.ts`
- [x] Create `src/tools/index.ts` (barrel export)
- [x] **TEST:** Ollama API and configured `qwen2.5:14b` are reachable
- [x] **TEST:** Live agent calls vault tools
- [x] **TEST:** Live multi-step loop writes and reads back a file in a temporary vault
- [ ] Add online provider registry/fallback (OpenAI/Anthropic); deferred while the configured Qwen local path is the target

## Phase 3: Tool Definitions & Vault Search
- [x] Create `src/tools/vault-search.ts` (case-insensitive recursive Markdown search)
- [x] Create `src/tools/vault-list.ts` (list vault directory contents)
- [x] **TEST:** Unit coverage for read/write/search/list and input validation
- [x] **TEST:** Agent searches, follows a search result with read, and lists a nested directory
- [x] **TEST:** Absolute paths, traversal, and external symlinks cannot escape the vault

## Phase 4: Email Integration (IMAP Pull)
- [ ] Create `src/integrations/email.ts` (IMAP connector)
- [ ] Create `src/tools/email-fetch.ts` (tool wrapper)
- [ ] Create `src/utils/state-tracker.ts` (processed email dedup)
- [ ] **TEST:** Fetch emails and write to `vault/Inbox/emails/`
- [ ] **TEST:** Deduplication works (same email not fetched twice)

## Phase 5: Memory Search — Hybrid RAG
- [ ] Create `src/memory/db.ts` (SQLite abstraction)
- [ ] Create `src/memory/embeddings.ts` (Ollama embeddings via lab52)
- [ ] Create `src/memory/search.ts` (hybrid keyword + vector)
- [ ] Upgrade `vault-search` tool to use hybrid search
- [ ] **TEST:** Index vault files into SQLite
- [ ] **TEST:** Hybrid search returns relevant results

## Phase 6: Heartbeat — Proactive Loop
- [ ] Create `src/heartbeat/cron.ts` (node-cron scheduler)
- [ ] Create `src/heartbeat/heartbeat-agent.ts` (proactive agent)
- [ ] Create `src/heartbeat/ingest.ts` (Inbox → Wiki compiler)
- [ ] **TEST:** Heartbeat runs on schedule
- [ ] **TEST:** Inbox items get compiled into Knowledgebase
- [ ] **TEST:** Daily log gets populated

## Phase 7: Calendar Integration
- [ ] Create `src/integrations/calendar.ts` (.ics parser)
- [ ] Create `src/tools/calendar-check.ts` (tool wrapper)
- [ ] **TEST:** Parse .ics and return upcoming events
- [ ] **TEST:** Agent can answer "What meetings do I have today?"

## Phase 8: Interactive CLI Chat
- [x] Create `src/index.ts` and `src/cli.ts` (readline CLI with streamed responses and session commands)
- [x] Create `src/memory/session.ts` (SQLite persistence, session isolation, and model-context compaction)
- [x] Create `src/memory/bootstrap.ts` (resumable first-run onboarding; updates USER.md/SOUL.md and removes trigger)
- [x] **TEST:** Multi-turn conversation and tool-call history work
- [x] **TEST:** History persists across process restarts
- [x] **TEST:** Bootstrap onboarding triggers on first run and resumes after interruption
- [x] **LIVE TEST:** Qwen streaming CLI answered across two separate process runs using a temporary vault/database

## Phase 9: Security & Deployment
- [ ] Create `src/utils/file-lock.ts` (concurrent write safety)
- [ ] Create `src/utils/remote.ts` (lab52 Ollama management wrapper)
- [ ] Harden `.env` handling (no secrets in vault)
- [ ] **TEST:** Concurrent heartbeat + CLI don't corrupt files
- [ ] **TEST:** Agent refuses to expose API keys

---

## Test Results Log

| Phase | Test | Result | Date |
|-------|------|--------|------|
| 1 | Vault structure/templates and dependency install | Passed | 2026-09-23 |
| 2 | Strict TypeScript check against installed AI SDK 7 | Passed | 2026-09-23 |
| 2 | Ollama API reachable; configured `qwen2.5:14b` available | Passed | 2026-09-23 |
| 2 | Live Qwen tool loop: search → read; write → read-back | Passed using temporary synthetic vault | 2026-09-23 |
| 3 | Vault tool unit tests | 8 passed, 0 failed | 2026-09-23 |
| 3 | Live Qwen search/read/list navigation | Passed using temporary synthetic vault | 2026-09-23 |
| 8 | Session persistence, isolation, compaction, CLI commands, and resumable onboarding unit tests | 9 passed, 0 failed | 2026-09-23 |
| 8 | Full test suite including Phase 3 regression tests | 17 passed, 0 failed | 2026-09-23 |
| 8 | Live Qwen CLI streaming and cross-restart recall (`FERN-731`) | Passed with temporary vault/database; model tool history persisted | 2026-09-23 |
