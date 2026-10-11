---
name: second-brain-fix
description: Resolve second-brain audit findings without guessing, by applying only exact evidence-backed state corrections and preserving superseded claims in history. Use when asked to fix stale memory or continue a vault audit.
---

# Second brain fix

Use `memoryAudit` to re-check the current evidence and apply any corrections that meet the built-in safety checks. The audit report is the work queue in app-owned local state; `log.md` is the append-only record of audit runs and correction actions. Do not create a second manual ledger or ask the user to copy findings from chat.

## Work order

1. Prioritize always-loaded files, then changed or overdue notes with an explicit `Current State` section.
2. Replace only a clearly contradicted current-state line when the newer source includes an exact quote, exact value, and explicit newer date. Preserve the old line verbatim in that note's `Log` and record the action in root `log.md`.
3. Keep unsupported and unclear claims unchanged and visible in the review panel. Never invent a replacement, infer a missing date, merge similar keys, or delete an unsupported claim.
4. Leave events, daily notes, Inbox, Archive, checklists, and unstructured history unchanged.
5. State the number of files checked, remaining coverage, auto-corrections, review items, and any errors. If the report is partial, say so plainly.

This workflow is intentionally incremental. Do not convert the whole vault into a new schema or rewrite prose for consistency. A user can inspect every finding in Settings, and each actual correction has a matching append-only log entry.
