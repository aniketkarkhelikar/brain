# AI Second Brain — Task Tracker

**Status:** 🚧 In Progress  
**Model:** `qwen2.5:14b` on lab52 (`172.25.128.20`)  
**Interface:** CLI  
**Started:** 2026-09-23

---

## Phase 1: Foundation — Vault Structure & Memory Layer
- [ ] Create `package.json` with all dependencies
- [ ] Create `tsconfig.json`
- [ ] Create `.env` with Ollama config
- [ ] Create vault directory structure
- [ ] Create `vault/SOUL.md` (agent identity)
- [ ] Create `vault/USER.md` (user profile template)
- [ ] Create `vault/MEMORY.md` (key facts store)
- [ ] Create `vault/HEARTBEAT.md` (proactive checklist)
- [ ] Create `vault/BOOTSTRAP.md` (onboarding wizard)
- [ ] Create `vault/index.md` and `vault/log.md`
- [ ] Install npm dependencies
- [ ] **TEST:** Verify vault structure exists and files are readable
- [ ] **TEST:** Verify npm install succeeds

## Phase 2: Provider Registry & Core Agent Engine
- [ ] Create `src/providers.ts` (multi-provider registry, Ollama → lab52)
- [ ] Create `src/agent.ts` (core generateText loop with tools)
- [ ] Create `src/tools/vault-read.ts`
- [ ] Create `src/tools/vault-write.ts`
- [ ] Create `src/tools/index.ts` (barrel export)
- [ ] **TEST:** Verify Ollama connectivity to lab52 (`qwen2.5:14b`)
- [ ] **TEST:** Verify basic tool calling (read a vault file via agent)
- [ ] **TEST:** Verify multi-step loop (read → write → confirm)

## Phase 3: Tool Definitions & Vault Search
- [ ] Create `src/tools/vault-search.ts` (keyword grep search)
- [ ] Create `src/tools/vault-list.ts` (list vault directory contents)
- [ ] **TEST:** Agent can search vault for keywords
- [ ] **TEST:** Agent can list and navigate vault structure

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
- [ ] Create `src/index.ts` (readline CLI with streaming)
- [ ] Create `src/memory/session.ts` (conversation persistence)
- [ ] **TEST:** Multi-turn conversation works
- [ ] **TEST:** History persists across restarts
- [ ] **TEST:** Bootstrap onboarding triggers on first run

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
| — | — | — | — |
