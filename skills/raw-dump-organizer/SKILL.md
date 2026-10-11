---
name: raw-dump-organizer
description: Processes unstructured, chaotic notes, voice memos, article clippings, or messy brain dumps from the inbox. Deconstructs multi-topic dumps into discrete concepts, extracts action items, creates or updates structured notes across knowledgebase, work, and personal categories, and maintains wikilink graph connectivity. Use when the user dumps raw thoughts, notes, clippings, or asks to organize and compile their inbox.
---

# Raw Dump Organizer Skill (Level 2: Procedural Instructions)

You are executing the **Raw Dump Organizer Skill**. Your mission is to eliminate information chaos by transforming raw, messy streams of thought into clean, structured, interconnected wiki entries.

---

## Phase 1: Semantic Ingestion & Decomposition
1. **Read Target Raw Source**: Use `vaultRead` to inspect the target file in `Inbox/` (or examine the unstructured text provided in chat).
2. **Deconstruct by Topic**: Multi-topic dumps must never be compiled as monolithic blocks. Separate into distinct items:
   - **Concepts & Mental Models**: Evergreen theories, domain principles, technical architectures.
   - **Work & Project Updates**: Actionable tasks, sprint progress, project specifications, meeting notes.
   - **Personal Context & Relationships**: Contact facts, preferences, personal reflections, habits.
   - **Decisions & Commitments**: Choices made with rationale and trade-offs.

---

## Phase 2: Knowledgebase Matching & Deduplication
1. For each extracted topic, run `vaultSearch` to check if a corresponding note already exists in the vault.
2. **Additive Synthesis**: If a matching note exists (e.g. `Work/projects/<project>.md` or `Knowledgebase/concepts/<concept>.md`), prepare an additive update that incorporates the new information without overwriting existing context.
3. **New Note Creation**: If no matching note exists, formulate a new note under the appropriate category.

---

## Phase 3: Category Destination Routing
*Strict Destination Rules:*
- **Projects & Work Initiatives**: `Work/projects/<slug>.md`
- **Meeting Minutes**: `Work/meetings/YYYY-MM-DD_<slug>.md`
- **Decisions Made**: `Work/decisions/YYYY-MM-DD_<slug>.md`
- **Concepts & Explanations**: `Knowledgebase/concepts/<slug>.md`
- **Comparisons & Benchmarks**: `Knowledgebase/comparisons/<slug>.md`
- **People & Contacts**: `Personal_context/people/<name>.md`
- **Personal Journals**: `Personal_context/journal/YYYY-MM-DD.md`
- **NEVER Dump to `MEMORY.md`**: Do not append raw dump contents to `MEMORY.md`.

---

## Phase 4: Graph Connectivity & Formatting
1. Ensure all created or updated notes include valid YAML frontmatter (`title`, `date`, `tags`).
2. Inject bidirectional `[[wikilinks]]` linking newly organized notes to parent or sibling concepts.
3. Ensure headings (`#`, `##`, `###`) follow clean hierarchy for semantic chunking and searchability.

---

## Phase 5: Cleanup & Archival
1. Move or archive the processed raw file from `Inbox/` to `Archive/` or rename with a `.processed` extension using `vaultMove`.
2. Append a compilation line to `vault/log.md` detailing the source file, notes created/updated, and timestamp.

---

## Phase 6: User Delivery
Summarize the organization outcome in chat:
1. Source dump processed.
2. List of notes created or updated with exact file paths.
3. Key action items or follow-ups extracted for immediate awareness.
