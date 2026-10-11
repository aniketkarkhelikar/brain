---
name: second-brain-audit
description: Conducts systematic audits of the entire second brain vault to eliminate context rot, verify mutable state claims against immutable event records, detect broken wikilinks, and identify orphan notes. Replaces outdated state facts and logs health metrics cleanly. Use when the user requests an audit, health check, review, or cleanup of their vault notes.
---

# Second Brain Audit Skill (Level 2: Procedural Instructions)

You are executing the **Second Brain Audit Skill** based on Cole Medin's auditing methodology.

Over time, second brain notes suffer from "context rot" because agents and humans append updates without replacing stale state facts. Your mission is to audit the vault, preserve immutable events, correct outdated state facts, and verify graph integrity.

---

## Core Distinction: State vs. Event
- **State facts** (mutable current attributes: active job title, current salary, active project, ongoing goal, contact email) must be updated or replaced when contradicted. Never let contradictory state facts accumulate.
- **Event facts** (immutable historical records: meeting minutes, completed transactions, timestamped log entries, lessons learned) must be preserved in append-only logs.

---

## Phase 1: Audit Always-Loaded Identity Files
1. Read `vault/SOUL.md`, `vault/USER.md`, and `vault/MEMORY.md` via `vaultRead`.
2. Extract all active state claims (e.g. current project, active tools, priority goals).
3. Search recent daily logs (`vault/daily/`) and `vault/log.md` for recent events that may contradict those claims.
4. Classify each claim:
   - **Confirmed**: Supported by recent activity.
   - **Contradicted (Rot)**: Newer events indicate the state has changed or concluded.
   - **Unsupported**: No recent evidence exists.

---

## Phase 2: Graph Integrity & Wikilink Linting
1. Retrieve the entire note inventory via `vaultCatalog`.
2. Inspect markdown content for `[[wikilinks]]`:
   - Detect **broken links** where the target file does not exist in the vault.
   - Detect **orphan notes** that have neither incoming nor outgoing links.
3. Check `Inbox/` for stale, uncompiled drafts older than 7 days.

---

## Phase 3: Targeted Remediation
1. **Patch Contradicted State**: Use `vaultPatch` on `USER.md` or `MEMORY.md` to update confirmed changes (e.g. archiving finished projects, updating changed preferences).
2. **Flag Broken Links**: Prepare a remediation list of broken links and suggest matching candidates.
3. **Never Mass-Delete**: Never delete notes automatically during an audit; propose candidates for user approval.

---

## Phase 4: Logging & Clean Output
1. **Append Audit Entry**: Log summary to `vault/log.md` with timestamp, scanned note count, contradicted claims resolved, broken link count, and orphan count.
2. **Zero Emojis**: Do NOT include emojis in `log.md` or status output.
3. **Daily Log Note**: Append a brief summary bullet to today's `vault/daily/YYYY-MM-DD.md`.

---

## Phase 5: User Briefing
Present a concise report in chat:
1. Total files scanned and health score.
2. Contradicted claims found and updated.
3. Broken links and orphan notes identified.
4. Confirmation of log entry in `vault/log.md`.
