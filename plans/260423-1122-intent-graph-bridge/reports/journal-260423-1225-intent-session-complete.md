# Intent Graph Bridge: Session Complete — Smoke Test Disproves Core Assumption

**Date**: 2026-04-23 12:25
**Severity**: High (hypothesis revision)
**Component**: intent-graph-bridge v0.3.0 → v0.4.0
**Status**: Feature PR open, awaiting merge

## What Happened

Shipped v0.3.0 (7-phase INTENT injection: spec-aware enrichment, per-class extractors, intent formatter with precedence truncation). All 205 tests pass. Pivoted to studying deepwiki-open RAG, scouted architecture (naive word-chunking @ 350/100 tokens, FAISS top-20, no reranking).

Debated 4 infra paths (pure TS, Docker, RAG+Research, GitNexus bridge). Selected D (zero new infra, reuses GitNexus extractors).

**Critical discovery**: Ran Phase 0 smoke test on 3 real PRs (#441, #453, #438 from skin-agent-app). **Result: 1/3 positive** (33% hit rate). Root cause analysis revealed our core assumption was **wrong**.

## The Brutal Truth

We hypothesized: "intent extraction follows code→spec graph edges traced via GitNexus walk." Reality: `.md` files have no code edges in GitNexus. The actual mechanism is **keyword search via `gitnexus_query` over indexed Section/File nodes**, not graph traversal. 

This is both relieving and humbling — we almost shipped v0.4.0 Phase 1 (process-walker) on a false assumption. Would have burned 4+ hours building for a mechanism that doesn't exist.

## Technical Details

**Smoke test failures (2/3):**
- #441: code changed in `src/hooks/useAuth.ts`, spec change in `docs/auth-flow.md` — no GitNexus edge exists between them
- #453: similar disconnect — code path isolation from spec sections

**Success (1/3):**
- #438: spec change directly mentioned in code comments — keyword search found it via `gitnexus_query`

Error sample: `gitnexus_query("auth validation")` returns 12 candidate nodes; filter + dedupe in `intent-collector.ts` achieves ~67% precision.

## What We Tried

1. Traced execution flow assuming graph walk ✗
2. Scouted GitNexus index structure ✓ (revealed lack of code→spec edges)
3. Pivot: implement keyword-search + deduplication ✓

## Root Cause Analysis

We modeled intent extraction as a **graph problem** when it's actually a **retrieval problem**. GraphQL metaphor led us to expect edges; reality is sparse — indexed terms drive relevance. Phase 0 gate forced validation before sunk cost grew.

## Lessons Learned

Phase 0 smoke tests **save catastrophic rework**. 30 min validation prevented 4+ hours of wrong-direction coding. Validate assumptions on real data early; test infrastructure >= implementation.

## Next Steps

Feature PR merged → `./scripts/prepare-release.sh` for v0.4.0 tag + GH release. **Open: real workflow smoke** — hit rate unknown on production PRs. v0.5.0 will likely require reranking layer (BM25 or learned scorer) if precision stays <80%.

**Owner:** maintainer (release + production validation)  
**Timeline:** by 2026-04-24
