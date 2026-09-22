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
// model: "nomic-embed-text" or "all-minilm"
// input: chunk text
```

#### [NEW] `src/memory/search.ts`
Hybrid search pipeline:
1. **Chunk** vault markdown files (~400 tokens, 50-token overlap)
2. **Embed** chunks via Ollama on lab52
3. **Index** into SQLite (sqlite-vec for vectors, FTS5 for keywords)
4. **Query:** 0.7 × vector similarity + 0.3 × keyword BM25 score
5. **Incremental:** Only re-index files modified since last indexing run

The `vault-search` tool in Phase 3 upgrades to use this hybrid pipeline once it's built.

---

### Phase 6: Heartbeat — The Proactive Loop

The core differentiator from a chatbot. A cron job that wakes the agent every 30 minutes.

#### [NEW] `src/heartbeat/cron.ts`
```typescript
import cron from 'node-cron';

// Every 30 minutes during active hours (8am-10pm IST)
cron.schedule('*/30 8-22 * * *', async () => {
  // 1. Pre-fetch data from integrations
  const newEmails = await emailIntegration.fetchNew();
  const upcomingMeetings = await calendarIntegration.getNext24Hours();
  
  // 2. If nothing new, write HEARTBEAT_OK to daily log and exit
  if (!newEmails.length && !upcomingMeetings.length) {
    await appendToDaily('HEARTBEAT_OK - no updates');
    return;
  }
  
  // 3. Run the heartbeat agent
  await heartbeatAgent.run({ newEmails, upcomingMeetings });
});
```

#### [NEW] `src/heartbeat/heartbeat-agent.ts`
A specialized agent invocation that:
1. Loads HEARTBEAT.md checklist into the system prompt
2. Receives pre-fetched email/calendar data as context
3. Uses tools to search the vault for related context (e.g., person profiles, project specs)
4. Writes updates to the appropriate vault locations:
   - New facts → `MEMORY.md` or relevant `Knowledgebase/` page
   - Meeting prep → `Work/meetings/prep_YYYY-MM-DD_title.md`
   - People updates → `Personal_context/people/name.md`
5. Appends a summary to `daily/YYYY-MM-DD.md`

#### [NEW] `src/heartbeat/ingest.ts`
The "compiler" — Karpathy's core innovation:
1. Scans `Inbox/` for files with `processed: false` frontmatter
2. For each unprocessed file:
   - Reads the raw content
   - Searches existing wiki pages for related topics
   - Either **updates** existing pages with new information, or **creates** new entity/concept pages
   - Adds `[[wikilinks]]` cross-references
   - Sets `processed: true` in the inbox file's frontmatter
3. Updates `index.md` with any new pages created
4. Appends operations to `log.md`

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
ollama pull nomic-embed-text    # For embeddings

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
| **4** | Email IMAP integration + inbox ingestion | 2-3 hours | Phase 1 |
| **5** | Hybrid RAG (SQLite + embeddings + search) | 3-4 hours | Phase 2, lab52 embedding model |
| **6** | Heartbeat cron loop + proactive agent + wiki compiler | 3-4 hours | Phases 3, 4, 5 |
| **7** | Calendar integration (.ics or OAuth) | 1-2 hours | Phase 6 |
| **8** | Interactive CLI chat interface | 2-3 hours | Phase 2 |
| **9** | Security, state tracking, deployment hardening | 2-3 hours | All above |

**Total estimated: ~3-4 day weekend sprint** for a working prototype.

Recommended build sequence: **1 → 2 → 3 → 8 → 4 → 5 → 6 → 7 → 9**
(Get the CLI chatbot working first with basic vault read/write, then layer in email + search + proactive features)

---

## Verification Plan

### Automated Tests
```bash
# Phase 2: Verify Ollama connectivity from this PC to lab52
python3 remote_exec.py "ollama run qwen2.5:14b 'Say hello in JSON format'"

# Phase 2: Verify Vercel SDK + Ollama tool calling
npx tsx src/test-tool-call.ts  # Simple script that calls generateText with 1 tool

# Phase 5: Verify hybrid search
npx tsx src/test-search.ts     # Index 3 test files, query, verify results

# Phase 6: Verify heartbeat loop
npx tsx src/heartbeat/cron.ts  # Run once manually, check daily log output
```

### Manual Verification
1. **Phase 1:** Open vault in any editor/Obsidian, verify folder structure and template content
2. **Phase 3:** Ask the CLI agent "What's in my vault?" → should use `vault-read` tool
3. **Phase 4:** Trigger email fetch → verify `.md` files appear in `Inbox/emails/`
4. **Phase 6:** Let heartbeat run for 1 hour → verify `daily/` log and any auto-generated prep docs
5. **Phase 8:** Have a multi-turn conversation → close and reopen → verify history persists


answers given by me
use qwen2.5:14b already on lab52 and supports json
for now cli
for now everything simple

go on start..!
maintain a task tracker .md that every ai agent working can follow and know the the status of the project till now

for every phae do indepth testing once working move to next one
