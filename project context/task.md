# AI Second Brain — Task Tracker

**Status:** Core phases 1, 2 (Ollama/Qwen path), 3, 5, 6 (vault-only heartbeat/compiler), and 8 complete; external integrations and Phase 9 security/deployment are deferred
**Model:** `qwen2.5:14b` on lab52 (`172.25.128.20`)  
**Interface:** CLI  
**Started:** 2026-09-23
**Checkpoint:** `4e41a5c` (`build phase 8 interactive CLI and sessions`, pushed to `origin/main`); Phase 5 search, onboarding fixes, deterministic retrieval routing, and Phase 6 are implemented in the current working tree and are not yet committed

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
- [x] Add `vaultCatalog` for complete inventory questions and force the first retrieval step for substantive prompts

## Phase 4: Email Integration (IMAP Pull)
**Status: Deferred at user request; do not start until explicitly resumed.**
- [ ] Create `src/integrations/email.ts` (IMAP connector)
- [ ] Create `src/tools/email-fetch.ts` (tool wrapper)
- [ ] Create `src/utils/state-tracker.ts` (processed email dedup)
- [ ] **TEST:** Fetch emails and write to `vault/Inbox/emails/`
- [ ] **TEST:** Deduplication works (same email not fetched twice)

## Phase 5: Memory Search — Hybrid RAG
- [x] Create `src/memory/db.ts` (SQLite, sqlite-vec cosine vectors, and FTS5)
- [x] Create `src/memory/embeddings.ts` (Ollama `all-minilm:l6-v2`, fixed at 384 dimensions)
- [x] Create `src/memory/search.ts` (approx. 400-token chunks, 50-token overlap, context-limit subdivision, SHA-256 incremental indexing)
- [x] Upgrade `vault-search` to combine file profiles, metadata/identifier matching, global semantic chunks, and FTS5 chunks with reciprocal-rank fusion
- [x] Keep file profiles as a coarse route only; global chunk search remains active for details omitted from summaries
- [x] Return up to three matching passages and full text for up to three small candidate notes
- [x] Generate a marked `index.md` catalog with filename, description, and relative path; preserve human-maintained sections
- [x] Re-index changed files on the next search and remove deleted files
- [x] **TEST:** SQLite vector insert/search/delete and FTS5 indexing
- [x] **TEST:** Hybrid semantic and exact-keyword retrieval; model/dimension mismatch and missing-index repair
- [x] **TEST:** Buried exact identifier remains retrievable when absent from the file profile
- [x] **TEST:** Unrelated queries with no keyword, metadata, or semantic evidence return no candidates
- [x] **TEST:** Path-scoped vector search applies the scope before KNN limits, even when unrelated Inbox chunks dominate the index
- [x] **LIVE TEST:** Ollama embedding dimension/quality check and end-to-end hybrid search on a temporary vault
- [x] **LIVE TEST:** Index the configured project vault and rerun indexing; second pass leaves all six files unchanged
- [x] **LIVE TEST:** Qwen agent calls `vaultSearch`, reads a search result, lists files, and validates a write using a temporary vault

## Phase 6: Heartbeat — Vault-only Proactive Loop
- [x] Create `src/heartbeat/cron.ts` (30-minute local scheduler, timezone configurable, overlap guard)
- [x] Create `src/heartbeat/heartbeat-agent.ts` (run orchestration and daily/operations logging)
- [x] Create `src/heartbeat/ingest.ts` (Inbox → Wiki compiler with structured Qwen plans)
- [x] Decompose mixed brain-dumps into up to eight independently routed topic actions; sample search terms across the full source
- [x] Park the complete source when any topic is ambiguous, preventing partial commits
- [x] Additive updates preserve existing wiki text; new notes use allowed folder categories and source wikilinks
- [x] Stable source hashes, a saved plan journal, and per-action provenance make multi-note interruption recovery idempotent
- [x] Ambiguous, oversized, and invalid outputs are parked for review instead of creating/overwriting a guessed destination
- [x] Add the CLI `/review` queue with user guidance and single-source retry
- [x] **TEST:** Create, update, already-known, review, retry, and invalid-target flows
- [x] **TEST:** Multi-topic create/update, all-or-nothing ambiguity, crash recovery, and review queue display
- [x] **TEST:** Heartbeat appends a dated daily log and an operation-log entry
- [x] **LIVE TEST:** Qwen decomposes one mixed brain-dump into an additive existing-project update and a separate new concept note
- [ ] Email and calendar prefetch remain deferred integrations

## Phase 7: Calendar Integration
**Status: Deferred with external integrations at the user's request.**
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
- [x] **TEST:** Bootstrap onboarding resumes from saved progress, updates sections idempotently, validates email input, and records variable schedules accurately
- [x] **LIVE TEST:** Qwen streaming CLI answered across two separate process runs using a temporary vault/database

## Phase 9: Security & Deployment
**Status: Deferred at the user's request; do not start until explicitly resumed.**
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
| 5 | TypeScript strict check | Passed | 2026-09-23 |
| 5 | Full automated regression suite (Phases 3, 5, 6, 8) | 37 passed, 0 failed | 2026-09-23 |
| 5 | `npm ls --depth=0` | All declared dependencies installed | 2026-09-23 |
| 5 | Ollama MiniLM embedding check | `all-minilm:l6-v2`, 384 dims; related cosine 0.443 vs unrelated 0.055 | 2026-09-23 |
| 5 | Live hybrid search/index test | Passed: semantic paraphrase, exact keyword, metadata, profile/catalog route, unchanged-file skip | 2026-09-23 |
| 5 | Configured vault indexing | Indexed six Markdown files into 16 chunks; second run re-embedded zero files; catalog block preserved the manual index sections | 2026-09-23 |
| 5 | Live Qwen tool loop | Passed with deterministic first retrieval routing; small search hits include their full note, and explicit list/write/read flows passed | 2026-09-23 |
| 3/8 | Live Qwen streaming retrieval | Loaded-profile question answered without a forced search call; explicit vaultSearch, list, write, and read tool flows passed in a temporary vault | 2026-09-23 |
| 5 | SQLite vector-key regression | Initial tests exposed sqlite-vec rowid binding failure; BigInt rowid binding fixed it and insert/update/delete tests now pass | 2026-09-23 |
| 5 | MiniLM input context limit | Real vault showed 1,400-character Markdown chunks could exceed 512 model tokens; disabled truncation and added split-and-retry for explicit context-limit errors | 2026-09-23 |
| 5 | Damaged index recovery | Deleted vector and FTS rows are detected and rebuilt on the next indexing pass | 2026-09-23 |
| 5 | Multi-channel retrieval and fallback | Unit tests confirm metadata/file-profile routing, global semantic/FTS detail retrieval, scoped KNN prefiltering, buried identifier recall, and no-result behavior for unsupported queries | 2026-09-23 |
| 3/5 | Deterministic retrieval routing | Catalog and search evidence are prefetched by code; loaded-profile questions skip redundant search; tool calls remain optional, avoiding forced-tool response failures | 2026-09-23 |
| 6 | Inbox compiler and heartbeat regression suite | Multi-topic create/update, all-or-nothing ambiguity, journal recovery, review retry, invalid target rejection, timezone daily log: passed in temporary vaults | 2026-09-23 |
| 6 | Live Qwen Inbox compile | Passed in a disposable vault: split one mixed source into a FERN-731 update and a separate concept note, preserving prior text and source links | 2026-09-23 |
| 6 | One-shot heartbeat CLI | Passed against a disposable vault; produced a dated daily log and operation log | 2026-09-23 |
| 6 | TypeScript and full regression suite | Strict TypeScript check passed; 42 tests passed, 0 failed | 2026-09-23 |
