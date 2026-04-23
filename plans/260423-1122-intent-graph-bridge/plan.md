---
title: INTENT × GitNexus Graph Bridge — v0.4.0
slug: intent-graph-bridge
created: 2026-04-23
status: implemented
mode: fast
approach: graph-augmented-intent
work_context: /Users/tunb/Documents/skin-agent-workspace/ultrareview-clone
brainstorm_report: ./reports/brainstorm-260423-1122-intent-graph-bridge.md
related_plans:
  - ../../plans/260423-1003-intent-injection-v0.3.0  # workspace plan; ships INTENT v0.3.0 modules we extend
  - ../../plans/260422-1712-ultrareview-gitnexus-integration  # workspace plan; ships GitNexus v0.2.0 query infra
blockedBy: []
blocks: []
---

# INTENT × GitNexus Graph Bridge — v0.4.0

Extend INTENT injection (v0.3.0) so it surfaces spec/doc files **not in the PR diff** by traversing GitNexus process graphs from changed code symbols. Reuses Phase 2 classifier + Phase 3 extractors + Phase 4 formatter — no new RAG infra.

## Context

- **v0.3.0 (just shipped)** — INTENT detects spec files in PR diff only (`scanSpecFiles` + extractors)
- **v0.2.0** — GitNexus IMPACT GRAPH (per-file process tracing)
- **v0.4.0 (this plan)** — bridge: changed-symbol → process → participant `.md` files → reuse extractors → merge into INTENT block

Brainstorm report: [`./reports/brainstorm-260423-1122-intent-graph-bridge.md`](./reports/brainstorm-260423-1122-intent-graph-bridge.md)

## Phases

| # | File | Scope | Effort | Deps |
|---|------|-------|--------|------|
| 0 | [phase-00-smoke-test-gate.md](./phase-00-smoke-test-gate.md) | Manual gitnexus_query on 3 PRs; decision gate | S | — |
| 1 | [phase-01-graph-spec-collector.md](./phase-01-graph-spec-collector.md) | `intent-from-graph.ts` — walk graph → spec paths | S | 0 ✅ |
| 2 | [phase-02-collector-merge.md](./phase-02-collector-merge.md) | Wire into `intent-collector.ts` + dedupe | S | 1 |
| 3 | [phase-03-tests.md](./phase-03-tests.md) | Unit + integration on temp git repo | S | 1, 2 |
| 4 | [phase-04-docs.md](./phase-04-docs.md) | README addendum + JSDoc + changeset | S | 3 |
| 5 | [phase-05-release-v0.4.0.md](./phase-05-release-v0.4.0.md) | `prepare-release.sh` run + verify | S | 4 |

**Effort legend**: S=<2h, M=2-6h, L=>6h

## Dependencies (within plan)

```
0 [GATE] ──> 1 ──> 2 ──> 3 ──> 4 ──> 5
        │
        └─[KILL]──> close, ship v0.3.0 only
```

**Phase 0 is a hard gate.** If 0/3 PRs surface useful related-spec via graph query → KILL plan, do not proceed.

## Key Files (touchpoints)

**New (ultrareview-clone):**
- `src/agent/intent-from-graph.ts` — graph→spec collector (~80 LOC)
- `src/__tests__/intent-from-graph.test.ts` — unit + integration
- `.changeset/intent-graph-bridge.md` — minor bump v0.4.0

**Modified:**
- `src/agent/intent-collector.ts` — call `collectFromGraph()` parallel; merge entries; dedupe
- `README.md` — append paragraph in Intent Injection section about graph bridge
- (No changes to: analyzer-prompt.ts, deep-analyzer.ts, agent-loop.ts — formatter already handles merged entries)

## Env Config (new — single addition)

```env
INTENT_GRAPH_BRIDGE=true               # default on; opt-out
INTENT_GRAPH_MAX_SPECS=2               # cap related specs per review (lowered post Phase 0)
INTENT_GRAPH_EXCLUDED=README.md,LICENSE,CONTRIBUTING.md  # noise filter
```

## Phase 0 Outcome (recorded 2026-04-23)

- Score: 1/3 PRs positive (PR #453 surfaced relevant plan)
- Gate: PROCEED
- **Design pivot**: original "graph-walk" hypothesis disproved; mechanism is **keyword search via `gitnexus_query`** over indexed `.md` Section/File nodes. See [`./reports/smoke-test-260423-graph-bridge.md`](./reports/smoke-test-260423-graph-bridge.md).
- Adjustments: MAX_SPECS lowered from 3 → 2; success-criteria hit-rate threshold ≥30% on 5 PRs (down from baseline expectation).

## Anti-Scope-Creep (NON-NEGOTIABLE)

- ❌ NO vector embeddings
- ❌ NO reranking
- ❌ NO BM25 / hybrid retrieval
- ❌ NO Deep Research / multi-iter loop
- ❌ NO wiki generation
- ❌ NO chunking strategy changes
- ❌ NO new external dependencies

If during impl you feel pulled toward any of the above → STOP, document in journal, defer to separate brainstorm.

## Success Criteria

- [x] Phase 0 gate passes (1/3 PRs surface useful spec via graph)
- [ ] INTENT block average growth ≤500 chars (deferred to v0.4.0 production smoke)
- [ ] Latency p95 adds ≤2s vs v0.3.0 (deferred to v0.4.0 production smoke)
- [x] Zero regression in existing tests (216 pass / 3 skip / 0 fail, +11 new tests)
- [ ] Manual review on 5 PRs: ≥3 surface a useful related spec (deferred to post-ship)
- [ ] v0.4.0 git tag + GH release shipped (run `./scripts/prepare-release.sh` to ship)

## Open Questions (carried into Phase 0)

1. Does GitNexus's process node currently include `.md` paths as participants, or only code files?
2. Best query API: `gitnexus_query` (semantic) vs `gitnexus_context` (per-symbol) vs `gitnexus_cypher` (custom)?
3. Confidence scoring: how to mark graph-derived entries to avoid confusing the existing truncation precedence?

These are pre-impl experiments handled in Phase 0 — answers feed Phase 1 design.

## Release Flow

Same as v0.3.0: `./scripts/prepare-release.sh` (already exists from v0.3.0 phase 7).

## Sync-back (2026-04-23)

**Completed Phases:** 0–4 (gate pass, code, merge, docs)  
**Phase 5 (release):** Deferred until feature PR https://github.com/cyberk-dev/ultrareview-action/pull/3 merged  
**Test Result:** 216 pass / 3 skip / 0 fail (+11 new tests)  
**Design Outcome:** Graph-walk hypothesis disproved; mechanism = keyword search via `gitnexus_query` over indexed markdown nodes  
**Key Artifacts:** intent-from-graph.ts (~80 LOC), 1 changeset (minor v0.4.0 bump), README addendum
