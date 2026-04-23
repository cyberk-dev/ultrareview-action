---
title: Smoke Test — INTENT × GitNexus Graph Bridge (Phase 0)
date: 2026-04-23
session: 12:00 ICT
plan: ../plan.md
gate_decision: PROCEED (1/3 positive — exactly meets threshold)
---

# Phase 0 Smoke Test Report

## Setup

- Index: `skin-agent-fe` (= `cyberk-dev/skin-agent-app`), 1634 files, 11953 nodes, 300 processes, indexed 2026-04-20
- Workspace index also available (28K files) but `skin-agent-fe` is the right scope for these PRs
- 604 `.md` files indexed as `File` nodes
- `.md` files have edges only: `CONTAINS` (folder→file, 1604) and `IMPORTS` (md→md cross-refs, 89). **No code→md edges exist.**

## Hypothesis Disproved

Original Phase D design assumed: walk graph from changed code symbol → process → participant `.md`.

**FALSE.** Process nodes contain only code symbols. `.md` files appear in `gitnexus_query` `definitions` only when query keywords overlap with the file/heading text (BM25-style match against indexed Section/File nodes).

→ **Mechanism is keyword search over indexed markdown corpus, NOT graph traversal.** Design must pivot.

## Test Results

### PR #441 — `fix(ios): burst-capture Swift/ObjC compile errors`
- Files: 3 iOS native (.podspec, .m, .swift)
- Queries tried:
  - `"burst capture iOS native module"` → 0 .md
  - `"burst capture multi-frame face scan camera"` → 0 .md
  - `"burst-capture compile errors testflight ios swift objc plan"` → 0 .md
- **Score: NEGATIVE**
- Note: legitimate negative — no matching spec exists in repo (chore-style fix has no associated plan). Bridge cannot help when there's nothing to retrieve.

### PR #453 — `feat(face-scan): Phase 06 MediaPipe Face Landmarker`
- Files: 31 (TS/Swift/Kotlin/Java + 1 native README)
- No `plans/.../phase-06-*.md` in diff
- Query: `"face landmarker mediapipe contour zone crop plan"` → returned **`plans/260420-1516-post-capture-contour-crop/plan.md`** + 2 of its Section nodes (`Post-Capture Contour-Based Zone Cropping`, `Problem Statement`)
- **Score: POSITIVE** — surfaced a directly-relevant plan that's NOT in the diff. Exactly the value the bridge is meant to add.

### PR #438 — `fix(face-scan): Vision Camera Swift/Objc bridging`
- Files: 60 (already includes 5 plans of `260303-ai-proxy-shared-fallback-pattern`)
- Query: `"vision camera bridging swift objc face overlay"` → 0 .md
- **Score: NEGATIVE**
- Note: query keywords are too generic / didn't overlap with any plan title. May change with smarter keyword extraction (file paths + symbol names + PR title combined).

## Decision Gate

| | Threshold | Actual |
|---|---|---|
| Positive PRs | ≥1/3 | **1/3** |
| Verdict | PROCEED | **PROCEED (borderline)** |

## Honest Assessment

**Bridge works** — PR #453 proves the mechanism delivers real value when conditions align.

**Conditions for hit:**
1. A relevant plan/spec must exist in `plans/`/`docs/`/`openspec/`
2. Query keywords must overlap with plan filename or H2 headings (BM25-style)
3. Chores/typo-fixes with no associated plan → no hit (expected, acceptable)

**Risk:** 1/3 hit rate is the floor. Real-world hit rate likely between 30-60% depending on plan vocabulary discipline. For features with named plans → high value. For ad-hoc fixes → no harm (graceful skip).

## Design Pivot Required

Original `intent-from-graph.ts` spec assumed process-walk. Revised design:

```ts
// REVISED: keyword-based search, not graph-walk
async function collectSpecsFromGraph({changedFiles, prTitle, changedSymbols}): Promise<SpecFileEntry[]> {
  // 1. Build query keywords: PR title + top symbol names + feature-area path components
  const keywords = deriveKeywords(changedFiles, prTitle, changedSymbols)
  // 2. Run gitnexus_query (single call) → returns processes + definitions
  const result = await gitnexus.query({ query: keywords.join(' '), limit: 5 })
  // 3. Harvest .md paths from definitions[] (Section + File nodes)
  // 4. Filter: match INTENT_SCAN_PATHS + excluded list + dedupe
  // 5. Cap at INTENT_GRAPH_MAX_SPECS (3)
  // 6. Return as SpecFileEntry[] with confidence=0.5, hint='via GitNexus query'
}
```

## Recommendation

**PROCEED to Phase 1 with revised design**, but adjust expectations:

1. ✅ Update `phase-01-graph-spec-collector.md` to reflect keyword-search mechanism (not process-walk)
2. ✅ Lower MAX_SPECS to 2 (keyword matches noisier than expected)
3. ✅ Document in README: "graph bridge surfaces specs when PR title/symbols overlap with plan vocabulary"
4. ✅ Add metric in production: count of bridge-fired vs no-fire across PRs to validate hit rate at 5+ real PRs (per success criteria)
5. 🚨 If full-impl smoke (Phase 5) shows <30% hit rate on 5 PRs → ship behind opt-in flag default OFF, not opt-out default ON

## Unresolved Questions

- Best keyword derivation strategy: PR title only? Title + path components? Title + top N symbol names?
- Should `gitnexus_query` be called once with combined keywords, or per-symbol with merging?
- Is there a way to tell `gitnexus_query` to **prefer** Section/File `.md` results (vs code symbols)?
- Embeddings are 0 in current index — would generating embeddings significantly improve hit rate vs pure BM25?
