---
name: project-breakdown-and-tracking
description: Decomposes complex goals or initiatives into sequential milestone phases, actionable task checklists, dependency maps, and risk mitigations. Mines existing project notes and active priorities from the vault, establishes clear success criteria, generates a structured project specification, and tracks execution progress. Use when the user wants to start a new project, break down a big goal, plan a roadmap, or track deliverables and blockers.
---

# Project Breakdown & Tracking Skill (Level 2: Procedural Instructions)

You are executing the **Project Breakdown & Tracking Skill**. Your mission is to bridge the gap between high-level ambition and daily execution by decomposing complex initiatives into clear, ordered, dependency-aware roadmaps.

---

## Phase 1: Objective Definition & Scope Clarification
1. **Analyze User Goal**: Extract the primary objective, target deadline, constraints, and success criteria.
2. **Vault Alignment**:
   - Check `USER.md` for active goals and priorities.
   - Search `Work/projects/` with `vaultSearch` to check if related projects or precursor work exist.
   - Check `Knowledgebase/` for relevant concepts or technical frameworks to link via `[[wikilinks]]`.
3. **Define End-State Invariants**: What must be true for this project to be declared complete?

---

## Phase 2: Work Breakdown Structure (WBS)
Decompose the objective into sequential phases with strict ordering:
1. **Phase 0: Research & Spike (Knowledge Gathering)**:
   - Unknowns to resolve, prototypes to test, documentation to read.
2. **Phase 1: Architecture & Foundation (Core Infrastructure)**:
   - Non-negotiable primitives, database schemas, core components, environment setups.
3. **Phase 2: Implementation & Iteration (Feature Delivery)**:
   - Discrete, testable deliverables grouped into bite-sized units.
4. **Phase 3: Hardening & Validation (QA & Launch)**:
   - Security auditing, edge-case testing, benchmarks, user acceptance, launch readiness.

---

## Phase 3: Risk & Dependency Mapping
1. **Critical Path Identification**: Which single bottleneck step blocks the rest of the project?
2. **Missing Dependencies**: Hardware access, API keys, credentials, third-party approvals, or domain knowledge.
3. **Pre-Mortem Failure Analysis**: What is the most probable reason this initiative might stall or fail, and what countermeasure prevents it?

---

## Phase 4: Project Spec Persistence
1. Write the structured project specification to:
   `Work/projects/<project_slug>.md`
   Format:
   - YAML Frontmatter: `title`, `date`, `status: active`, `tags: [project, roadmap]`.
   - Objective & Success Metrics.
   - Core Architecture & Decisions.
   - Sequential Milestone Phases (with markdown task checkboxes `[ ]`).
   - Dependency & Risk Log.
   - Related Notes (`[[wikilinks]]` to concepts and meeting notes).
2. **Zero `MEMORY.md` Dumping**: Do NOT write lengthy project breakdowns into `MEMORY.md`. If this is a top-level primary active project, only a single 1-line reference belongs in `MEMORY.md` under `## Active Projects`.

---

## Phase 5: User Delivery
Present a clear executive roadmap in chat:
1. **Project Architecture**: The 30,000-foot execution flow.
2. **Immediate Phase 1 Checklist**: 3–5 concrete actions to begin right away.
3. **Critical Path Alert**: The key blocker or prerequisite to resolve first.
4. **Spec Location**: Exact relative path in `Work/projects/` where the project document is maintained.
