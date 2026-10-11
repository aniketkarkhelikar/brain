---
name: contract-and-document-analyzer
description: Analyzes contracts, legal agreements, leases, insurance policies, terms of service, and warranties for hidden risks, unfair liabilities, and fine-print traps. Cross-references clauses against market norms and jurisdictional regulations via web search, dynamically generates a risk rating matrix, and drafts clear redlines or negotiation questions. Use when the user shares an agreement, contract, policy, or asks to review legal/financial documents.
---

# Contract & Document Analyzer Skill (Level 2: Procedural Instructions)

You are executing the **Contract & Document Analyzer Skill**. Your mission is to protect the user from asymmetrical liabilities, predatory clauses, and fine-print surprises in legal and commercial agreements.

*Disclaimer: Provide structured analytical diligence and negotiation guidance, noting when certified legal counsel is advised for high-stakes contracts.*

---

## Phase 1: Ingestion & Structural Mapping
1. Read the document text or referenced vault file via `vaultRead`.
2. Extract core commercial terms:
   - Parties involved and effective dates.
   - Financial consideration, payment schedules, penalty interest, and currency.
   - Core deliverables and service-level commitments.
   - Governing law and dispute resolution jurisdiction.

---

## Phase 2: High-Risk Clause Diligence
*Examine the document for the top asymmetric vulnerability patterns:*
1. **Termination & Auto-Renewal**:
   - Are there automatic renewal traps with narrow notification windows?
   - What are the early termination fees or liquidated damages?
2. **Indemnification & Liability Caps**:
   - Is indemnification mutual or one-sided?
   - Is liability capped (e.g. at 12 months fees), or are damages unlimited?
   - Are consequential and indirect damages properly excluded?
3. **Restrictive Covenants & IP Ownership**:
   - For employment/consulting: Are non-compete, non-solicitation, or IP assignment clauses overly broad or indefinite?
4. **Warranties & Exclusion Clauses**:
   - Are essential implied warranties disclaimed ("AS IS")?
   - What are the claim reporting deadlines and required notice methods?

---

## Phase 3: External Norms & Statutory Cross-Check
1. Query `webSearch` with `useLocation: true` to verify local statutory requirements (e.g. statutory tenant rights, enforceability of non-competes in the user's jurisdiction, mandatory insurance disclosure laws).
2. Use `webRead` on statutory guidance or legal summaries when assessing unusual clauses.

---

## Phase 4: Dynamic Risk Matrix & Redline Synthesis
*Dynamically categorize each notable clause into a structured risk rating:*
1. **Red Flags (Critical Risks)**: Asymmetric liabilities, unlimited exposure, or punitive penalties that must be rejected or amended.
2. **Yellow Flags (Caution Areas)**: Ambiguous definitions, tight cure periods, or missing standard exclusions that need clarification.
3. **Green (Standard)**: Standard market boilerplate clauses.
4. **Draft Specific Redline Counter-Proposals**: Write alternative clause wording that balances the obligation.

---

## Phase 5: Vault Persistence
1. **Write Review Memo**: Save complete analysis to:
   `Work/decisions/YYYY-MM-DD_<agreement_name>_review.md`
   Format:
   - YAML Frontmatter: `title`, `date`, `status: reviewed`, `tags: [contract, legal, review]`.
   - Agreement Overview & Parties.
   - Dynamic Clause Risk Matrix (Red/Yellow/Green).
   - Recommended Redline Revisions.
   - Questions to Raise with Counterpart.
2. **Zero `MEMORY.md` Dumping**: Do NOT write document reviews into `MEMORY.md`.

---

## Phase 6: User Delivery
Present a direct executive brief in chat:
1. Overall Risk Verdict (High / Moderate / Low).
2. The Top 3 Red Flags requiring immediate renegotiation.
3. Specific suggested counter-language or questions to send the other party.
4. Relative path to the saved analysis in `Work/decisions/`.
