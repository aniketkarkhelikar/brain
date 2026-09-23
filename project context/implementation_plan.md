# AI Second Brain — Full Implementation Plan

**Goal:** Build a proactive, self-maintaining AI Second Brain inspired by Andrej Karpathy's "LLM Wiki" compiler and Cole Medin's 9-phase architecture — adapted from Claude Code/Python to **Vercel AI SDK + TypeScript + Ollama** running on your remote GPU server (`lab52`).

## Background & Conceptual Architecture

### What This Is
An autonomous AI system that:
- **Ingests** raw data (emails, meeting notes, thoughts) into an `Inbox/`
- **Compiles** raw data into a structured, cross-referenced Markdown Wiki (Karpathy's paradigm)
- **Proactively monitors** your email, calendar, and tasks every 30 minutes (Cole's "Heartbeat")
- **Answers questions** by reasoning over the pre-compiled wiki, not raw chunks
- **Self-heals** through periodic lint/audit passes that fix broken links, deduplicate, and prune

### The Key Insight (Karpathy → Cole Adaptation)
$$\text{Raw Data (Inbox/)} \xrightarrow[\text{Ollama Agent}]{\text{Compile}} \text{Structured Wiki (Knowledgebase/)}$$

Karpathy defined the **data architecture** (raw → compiled wiki). Cole built the **operational engine** (SOUL.md identity, HEARTBEAT.md proactive checklist, session hooks, memory flush). We combine both and rewrite the engine in TypeScript using the Vercel AI SDK.

### Infrastructure Split
| Component | Runs Where | Why |
|---|---|---|
| Ollama LLM inference | **lab52** (remote GPU server at `172.25.128.20`) | GPU-accelerated inference |
| Vault (markdown files) | **This PC** (local) | You read/edit files locally |
| Node.js agent daemon | **This PC** (local) | Orchestrates tools, cron, integrations |
| Email/Calendar APIs | **This PC** (local) | OAuth tokens stay local |

---

## User Review Required

> [!IMPORTANT]
> **Model Selection:** The plan assumes `qwen2.5:14b` or `llama3.1:8b` on lab52 for reliable tool calling. Smaller 3B models frequently fail at structured JSON output. Do you have a preference, or should we test both?

> [!IMPORTANT]
> **Email Provider:** The plan uses Gmail IMAP with App Passwords (avoids OAuth complexity for v1). If you need full Gmail API (labels, send), we'll need Google Cloud Console setup. Which do you prefer for v1?

> [!WARNING]
> **Calendar Integration:** Google Calendar requires OAuth2 (no IMAP shortcut). For v1, we can use a private `.ics` URL export as a simpler alternative. Want full OAuth or `.ics` for the first version?

---

## Open Questions

> [!IMPORTANT]
> 1. **Which Ollama model** is already pulled on lab52? Run `python3 remote_exec.py "ollama list"` to check.
> 2. **Gmail account** — do you have an App Password set up, or do you want full OAuth2?
> 3. **Calendar source** — Google Calendar, Outlook, or another provider?
> 4. **Chat interface** — do you want a CLI-only agent for v1, or a Slack/Discord bot from the start?
> 5. **Online model fallback** — should the system automatically fall back to OpenAI/Anthropic when Ollama is unreachable, or stay local-only?

---

## Proposed Changes

The project lives at `/home/aniket-ramdasi/workspace/ai_brain/`. Everything below is organized by Cole's 9-phase build order, adapted to our TypeScript/Vercel SDK stack.

---

### Phase 1: Foundation — Vault Structure & Memory Layer

The file system IS the database. Plain markdown, Git-versioned, human-readable.

#### [NEW] Vault directory structure

```
ai_brain/
├── remote_exec.py                    # (existing) SSH to lab52
├── package.json                      # Node.js project config
├── tsconfig.json                     # TypeScript config
├── .env                              # API keys, Ollama URL, model config
├── src/
│   ├── index.ts                      # Main entry point
│   ├── providers.ts                  # Multi-provider model registry (Ollama/OpenAI/Anthropic)
│   ├── agent.ts                      # Core agent loop (generateText + tools)
│   ├── tools/                        # Tool definitions
│   │   ├── vault-read.ts             # Read files from vault
│   │   ├── vault-write.ts            # Write/update vault files
│   │   ├── vault-search.ts           # Hybrid search (keyword + semantic)
│   │   ├── email-fetch.ts            # Pull new emails
│   │   ├── calendar-check.ts         # Check upcoming events
│   │   └── index.ts                  # Tool registry barrel
│   ├── integrations/
│   │   ├── email.ts                  # IMAP/Gmail connector
│   │   ├── calendar.ts               # Calendar connector
│   │   └── registry.ts               # Integration registry
│   ├── heartbeat/
│   │   ├── cron.ts                   # node-cron scheduler (every 30 min)
│   │   ├── heartbeat-agent.ts        # Heartbeat-specific agent invocation
│   │   └── ingest.ts                 # Inbox → Wiki compiler
│   ├── memory/
│   │   ├── session.ts                # Chat history persistence (SQLite)
│   │   ├── search.ts                 # Hybrid RAG (keyword + vector)
│   │   ├── embeddings.ts             # FastEmbed or Ollama embeddings
│   │   └── db.ts                     # SQLite abstraction (sqlite-vec + FTS5)
│   └── utils/
│       ├── file-lock.ts              # Cross-process file locking
│       ├── state-tracker.ts          # Deduplication (processed_ids.json)
│       └── remote.ts                 # Wrapper around remote_exec.py
└── vault/                            # THE SECOND BRAIN
    ├── SOUL.md                       # Agent identity & behavioral rules
    ├── USER.md                       # Your profile, preferences, schedule
    ├── MEMORY.md                     # Key decisions, lessons, active projects
    ├── HEARTBEAT.md                  # Proactive monitoring checklist
    ├── BOOTSTRAP.md                  # First-run onboarding wizard (self-deletes)
    ├── index.md                      # Auto-maintained vault index
    ├── log.md                        # Operations log (append-only)
    ├── Inbox/                        # Raw data dump zone
    │   ├── emails/                   # Raw email text files
    │   ├── notes/                    # Quick thoughts, voice transcripts
    │   └── clips/                    # Web clips, PDFs
    ├── Knowledgebase/                # Compiled wiki (agent-maintained)
    │   ├── concepts/                 # Concept pages (e.g., "RAG.md", "Vector-DBs.md")
    │   ├── entities/                 # People, companies, projects
    │   └── comparisons/              # X-vs-Y analysis pages
    ├── Personal_context/             # CRM, relationships, journal
    │   ├── people/                   # Per-person profiles
    │   ├── journal/                  # Daily reflections
    │   └── preferences.md            # Communication style, schedule patterns
    ├── Work/                         # Active projects, meeting prep
    │   ├── projects/                 # Per-project specs & architecture docs
    │   ├── meetings/                 # Meeting prep & notes
    │   └── decisions/                # Decision logs with rationale
    ├── Archive/                      # Processed inbox items
    └── daily/                        # Daily session logs (YYYY-MM-DD.md)
```

#### [NEW] `vault/SOUL.md`
Adapted from Cole's template — defines agent identity, behavioral guardrails, proactive vs. reactive rules. Key sections:
- Core Identity & Values (direct, opinionated, resourceful)
- Proactive Behavior rules (bold internally, ask before external actions)
- Memory Management principles (what to persist, what to discard)

#### [NEW] `vault/USER.md`
Your personal profile — populated during bootstrap or manually:
- Basic info (name, email, timezone)
- Professional context (role, projects, team)
- Working style (communication preferences, schedule patterns)
- Integration accounts (Gmail address, calendar ID)

#### [NEW] `vault/HEARTBEAT.md`
Adapted from Cole's template — the proactive monitoring checklist:
- **Quick Checks (every heartbeat):** Urgent emails in last 2h, calendar events in next 4h
- **Proactive Suggestions:** What needs prep, what's overdue
- **Anomaly Detection:** Email spikes, cancelled meetings, stale tasks
- **Notification Rules:** When to notify immediately vs. batch vs. stay silent

#### [NEW] `vault/BOOTSTRAP.md`
First-run onboarding wizard. When the agent detects this file exists, it conducts an interactive interview to populate SOUL.md, USER.md, and HEARTBEAT.md. Self-deletes after completion.

---

### Phase 2: Provider Registry & Core Agent Engine

The brain of the system — Vercel AI SDK wired to Ollama (on lab52) with automatic fallback to cloud providers.

#### [NEW] `src/providers.ts`
Multi-provider model registry using `createProviderRegistry`:
```typescript
// Registers: ollama (→ lab52:11434), openai, anthropic
// Single env var ACTIVE_MODEL="ollama:qwen2.5:14b" switches models
// Ollama points to http://172.25.128.20:11434/api (lab52)
```

Key design decisions:
- Uses `ollama-ai-provider-v2` pointing at lab52's IP
- Falls back to `@ai-sdk/openai` or `@ai-sdk/anthropic` if configured
- `numCtx: 16384` explicitly set to avoid Ollama's 2048 default truncation trap
- All providers implement the same `LanguageModel` interface — tools/prompts are identical

#### [NEW] `src/agent.ts`
Core agent loop using `generateText` with multi-step tool execution:
```typescript
// generateText({
//   model: registry.languageModel(process.env.ACTIVE_MODEL),
//   system: SOUL.md content + USER.md content + MEMORY.md content,
//   messages: sessionHistory,
//   tools: { vaultRead, vaultWrite, vaultSearch, emailFetch, calendarCheck },
//   stopWhen: isStepCount(6),
//   prepareStep: ({ stepNumber }) => {
//     if (stepNumber >= 5) return { toolChoice: 'none' }; // Force synthesis
//   },
// })
```

The auto-improving loop (Cole's PIV translated to Vercel SDK):
1. **Plan:** Agent reads HEARTBEAT.md, decides what to check
2. **Implement:** Calls tools (search vault, fetch emails, read calendar)
3. **Validate:** On each step, SDK feeds tool results back to model. If a tool returns `{ success: false, error }`, the model self-corrects on the next step
4. Terminates naturally when model produces text without tool calls, or at `maxSteps` limit

#### [NEW] `src/memory/session.ts`
Chat history persistence using SQLite:
- Stores `ModelMessage[]` arrays per conversation
- `result.response.messages` captures all intermediate tool calls + results
- Supports conversation continuation across sessions
- Context compaction: when history exceeds 16 messages, keeps first 2 + last 14

---

### Phase 3: Tool Definitions

Each tool is a Zod-validated function the LLM can invoke during its reasoning loop.

#### [NEW] `src/tools/vault-read.ts`
```typescript
tool({
  description: 'Read a file from the vault by path',
  parameters: z.object({
    path: z.string().describe('Relative path within vault/, e.g. "Work/projects/FoodTrace.md"'),
  }),
  execute: async ({ path }) => {
    const content = await fs.readFile(`vault/${path}`, 'utf-8');
    return { success: true, content };
  },
})
```

#### [NEW] `src/tools/vault-write.ts`
Write or append to vault files. The LLM uses this to:
- Update wiki pages in `Knowledgebase/`
- Write meeting prep docs in `Work/meetings/`
- Append to daily logs in `daily/`
- Update `MEMORY.md` with new decisions/lessons

#### [NEW] `src/tools/vault-search.ts`
Keyword search across all vault markdown files using ripgrep-style matching. In Phase 5 (Memory Search), this upgrades to hybrid keyword + vector search.

#### [NEW] `src/tools/email-fetch.ts`
Tool wrapper around the email integration — lets the LLM pull recent emails and filter by sender/subject.

#### [NEW] `src/tools/calendar-check.ts`
Tool wrapper around the calendar integration — lets the LLM check upcoming events in the next N hours.

---

### Phase 4: Email Integration (IMAP Pull)

**Current project scope:** Email integration is deferred. Core phases 5, 6, and 8 are implemented; keep email and calendar integrations plus Phase 9 security/deployment out of scope until resumed.

#### [NEW] `src/integrations/email.ts`
Email ingestion pipeline:
1. **Connect** to Gmail via IMAP (`imapflow` package) using App Password
2. **Fetch** unread emails since last check (tracked in `state/processed_emails.json`)
3. **Strip HTML** → convert to clean markdown text (`html-to-text` package)
4. **Write** each email as a `.md` file in `vault/Inbox/emails/YYYY-MM-DD_subject.md`
5. **Track** processed email UIDs to prevent reprocessing

YAML frontmatter on each email file:
```yaml
---
from: sender@email.com
subject: Re: FoodTrace API Review
date: 2026-09-23T10:30:00+05:30
processed: false
---
```

The `processed: false` flag tells the ingest cycle this email hasn't been compiled into the wiki yet.

---

### Phase 5: Memory Search — Hybrid RAG

#### [NEW] `src/memory/db.ts`
SQLite database with two extensions:
- **sqlite-vec**: Vector similarity search (384-dim embeddings)
- **FTS5**: Full-text keyword search

#### [NEW] `src/memory/embeddings.ts`
Embedding generation using Ollama's embedding endpoint on lab52:
```typescript
// POST http://172.25.128.20:11434/api/embed
// model: "all-minilm:l6-v2" (384 dimensions)
// input: chunk text
```

#### [NEW] `src/memory/search.ts`
Hybrid search pipeline:
1. **Chunk** vault Markdown into approximately 400-token pieces with a 50-token overlap (implemented as a 1,600-character target and 200-character overlap, with paragraph/word boundaries; Ollama truncation is disabled, and any chunk the model rejects for context length is subdivided and retried).
2. **Build a compact file profile** from path, title, description, tags, and headings; embed profiles in batches for a cheap catalog-level route.
3. **Index** file profiles and note chunks in SQLite (`sqlite-vec`) with exact text in FTS5.
4. **Retrieve in parallel:** file-profile similarity, title/path/metadata matches, chunk semantic similarity, and chunk BM25. Fuse rankings with reciprocal rank fusion instead of directly adding cosine and BM25 values, whose scales are not comparable.
5. **Keep a global detail path:** the file profile ranks likely notes but never filters chunk search. This preserves recall for identifiers and facts omitted from summaries. Return up to three supporting passages; the search tool also supplies up to three full notes below a size limit.
6. **Incremental:** SHA-256 content hashes ensure only added/changed files are embedded; deleted files are removed; missing profile/vector/FTS rows trigger repair.
7. **Catalog:** Maintain a marked block in `vault/index.md` with each filename, description, and vault-relative path; preserve human-edited sections. A dedicated `vaultCatalog` tool reads the complete inventory for broad list questions.

The application loads the complete catalog for broad inventory prompts and performs a bounded pre-search for other substantive vault questions before calling the model. Profile questions use the already loaded `USER.md` context and skip redundant search. Search evidence is supplied to the model so Qwen can answer directly; tools remain available for follow-up reads without a required `toolChoice` that can reject a valid direct answer. The Phase 3 `vault-search` tool uses this hybrid pipeline.

---

### Phase 6: Heartbeat — The Proactive Loop

The core proactive loop is vault-only until email and calendar integrations are resumed. It runs every 30 minutes from 08:00 through 22:30 in the configured timezone (`Asia/Kolkata` by default), compiles local Inbox Markdown, and records a daily log. Run it once with `npm run heartbeat -- --once`; use `npm run ingest` to compile without starting the scheduler.

#### [NEW] `src/heartbeat/cron.ts`
```typescript
import cron from 'node-cron';
import { runHeartbeat } from './heartbeat-agent.js';

cron.schedule('*/30 8-22 * * *', () => runHeartbeat(), { timezone: 'Asia/Kolkata' });
```

#### [NEW] `src/heartbeat/heartbeat-agent.ts`
A vault-only heartbeat runner that:
1. Invokes the Inbox compiler and reports created, updated, already-known, review, and failed items.
2. Uses the local Ollama model to produce a structured compile plan. The deterministic runner validates destinations against retrieved candidates and allowed categories.
3. Appends run details to `daily/YYYY-MM-DD.md` and a concise line to `log.md`.
4. Prevents duplicate processing with stable source hashes in Inbox frontmatter and exact provenance markers in compiled notes. Updates append new sections rather than replacing existing wiki text.
5. Parks ambiguous, oversized, or invalid plans for review instead of guessing. `--retry-review` reruns these items.

#### [NEW] `src/heartbeat/ingest.ts`
The "compiler" — Karpathy's core innovation:
1. Scans Markdown under `Inbox/`, skipping hidden files and symlinks.
2. Searches only compiled `Knowledgebase/`, `Work/`, and `Personal_context/` notes for candidates; raw Inbox files cannot route themselves.
3. Samples terms across the whole source, then asks Qwen in one schema-validated call to split it into up to eight topic actions: additive update, new page in an allowed folder, already-known, or needs-review.
4. Applies an Inbox file only if every topic has a clear destination. One ambiguous topic parks the whole source, preventing partial or guessed writes.
5. Preserves existing note text, adds dated updates and `[[Inbox/...]]` source links, or creates new notes with per-action provenance.
6. Saves the validated plan before writing. On restart, source markers and the saved plan resume unfinished writes without duplicating completed actions.
7. Exposes failed and ambiguous sources in the CLI `/review` queue. A user can add a destination hint and retry only the selected source.
8. Marks a source processed only after all planned actions finish; refreshes the catalog and search index after processing.

---

### Phase 7: Calendar Integration

#### [NEW] `src/integrations/calendar.ts`
**v1 (Simple):** Parse a private `.ics` URL from Google Calendar
- Fetches the `.ics` file every heartbeat
- Parses events using `ical.js` or `node-ical`
- Returns events in the next N hours with title, time, attendees, description

**v2 (Full):** Google Calendar API with OAuth2
- Uses `googleapis` package with OAuth2 credentials
- Can read events AND create prep docs automatically

---

### Phase 8: Chat Interface (CLI + Optional Web)

#### [NEW] `src/index.ts` — Interactive CLI
A `readline`-based CLI that:
1. On startup, loads `SOUL.md + USER.md + MEMORY.md + recent daily logs` as system context
2. Detects if `BOOTSTRAP.md` exists → runs onboarding interview first
3. Accepts user input, passes to the agent with full tool access
4. Persists conversation history to SQLite
5. Supports streaming output via `streamText` for real-time token display

```
$ npm start
🧠 Second Brain Agent v1.0 (model: ollama:qwen2.5:14b @ lab52)
Loading vault context... ✓
> What did Sarah say about the API redesign?
[Searching vault/Personal_context/people/sarah.md...]
[Searching vault/Inbox/emails/...]
Based on Sarah's email from Sept 20 and the meeting notes from Sept 18...
```

#### [NEW] (Optional, Phase 9) Web UI with Next.js
If desired later, a Next.js frontend using `@ai-sdk/react` `useChat` hook:
- Connects to the same agent backend
- Shows streaming responses with tool call visibility
- Displays vault file tree sidebar

---

### Phase 9: Security, State Tracking & Deployment

#### [NEW] `src/utils/state-tracker.ts`
Prevents duplicate processing:
```typescript
// state/processed_emails.json — tracks email UIDs
// state/last_heartbeat.json — timestamp of last heartbeat run
// state/index_checksums.json — file hashes for incremental re-indexing
```

#### [NEW] `src/utils/file-lock.ts`
Cross-process file locking for concurrent writes (heartbeat + CLI both writing to daily logs).

#### [NEW] `src/utils/remote.ts`
TypeScript wrapper around `remote_exec.py` for managing Ollama on lab52:
- Check if Ollama is running
- Pull models
- Monitor GPU memory
- Restart Ollama if needed

#### Lab52 Setup (via `remote_exec.py`)
Commands to run on the GPU server:
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull recommended models
ollama pull qwen2.5:14b        # Best tool-calling for its size
ollama pull all-minilm:l6-v2    # 384-dimensional embeddings for Phase 5

# Configure Ollama to listen on all interfaces (not just localhost)
# Edit /etc/systemd/system/ollama.service → OLLAMA_HOST=0.0.0.0
# Expose on port 11434 for remote access from this PC

# Set num_ctx globally
# In /etc/ollama/modelfile or per-request via API
```

---

## Dependency Stack

```json
{
  "dependencies": {
    "ai": "^7.0.0",
    "ollama-ai-provider-v2": "latest",
    "@ai-sdk/openai": "latest",
    "@ai-sdk/anthropic": "latest",
    "zod": "^3.23",
    "node-cron": "^3.0",
    "imapflow": "^1.0",
    "html-to-text": "^9.0",
    "node-ical": "^0.18",
    "better-sqlite3": "^11.0",
    "gray-matter": "^4.0",
    "dotenv": "^16.0",
    "glob": "^11.0",
    "readline": "builtin"
  },
  "devDependencies": {
    "typescript": "^5.6",
    "tsx": "^4.0",
    "@types/node": "^22",
    "@types/better-sqlite3": "^7.0"
  }
}
```

---

## Build Order & Timeline

| Phase | What | Estimated Effort | Dependencies |
|-------|------|-----------------|--------------|
| **1** | Vault structure + SOUL/USER/HEARTBEAT/BOOTSTRAP templates | 1-2 hours | None |
| **2** | Provider registry + core agent loop with 2 tools (read/write) | 2-3 hours | Phase 1, lab52 Ollama running |
| **3** | Full tool definitions (vault-read, vault-write, vault-search) | 1-2 hours | Phase 2 |
| **4** | Email IMAP integration + inbox ingestion (deferred) | 2-3 hours | Phase 1 |
| **5** | Hybrid RAG (SQLite + embeddings + search) | 3-4 hours | Phase 2, lab52 embedding model |
| **6** | Local heartbeat + Inbox-to-Wiki compiler | 3-4 hours | Phases 3, 5 |
| **7** | Calendar integration (.ics or OAuth) | 1-2 hours | Phase 6 |
| **8** | Interactive CLI chat interface | 2-3 hours | Phase 2 |
| **9** | Security, state tracking, deployment hardening | 2-3 hours | All above |

**Total estimated: ~3-4 day weekend sprint** for a working prototype.

Recommended build sequence: **1 → 2 → 3 → 8 → 5 → 6 → 7 → 9**
(Phase 6's local compiler does not depend on email or calendar integrations. Phases 4 and 7 can populate Inbox later; Phase 9 security and deployment work also remains deferred.)

---

## Verification Plan

### Automated Tests
```bash
# Phase 2: Verify Ollama connectivity from this PC to lab52
python3 remote_exec.py "ollama run qwen2.5:14b 'Say hello in JSON format'"

# Phase 2: Verify Vercel SDK + Ollama tool calling
npm run test:agent             # Live Qwen search/read/list/write tool loop

# Phase 5: Verify hybrid search
npm run test:embeddings        # Verify Ollama MiniLM returns 384-dim vectors
npm run test:memory            # Index a temporary vault and query semantic/exact terms
npm run test:agent             # Live Qwen tool loop against a temporary vault
npm run index:vault            # Explicitly index the configured vault

# Phase 6: Verify local compiler and heartbeat
npm test                       # Includes Inbox compiler, recovery, review, and daily-log tests
npm run test:ingest            # Live Qwen compile in a disposable vault
npm run heartbeat -- --once    # Run one heartbeat against the configured vault
```

### Manual Verification
1. **Phase 1:** Open vault in any editor/Obsidian, verify folder structure and template content
2. **Phase 3/5:** Ask the CLI agent "What projects are in my vault?" → should read the complete catalog; ask about a buried exact detail → search should find its source note.
3. **Phase 6:** Drop a Markdown note in `Inbox/notes/`, run `npm run ingest`, then verify the source's processed metadata, linked destination note, and daily heartbeat log.
4. **Phase 8:** Have a multi-turn conversation → close and reopen → verify history persists.
5. **Deferred:** Email, calendar integrations, security, and deployment hardening remain out of the current scope.


answers given by me
use qwen2.5:14b already on lab52 and supports json
for now cli
for now everything simple

go on start..!
maintain a task tracker .md that every ai agent working can follow and know the the status of the project till now

for every phae do indepth testing once working move to next one
