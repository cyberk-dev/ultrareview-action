# Phase 1 — Graph Spec Collector (REVISED post Phase 0)

## Context Links
- Phase 0 smoke test: [`./reports/smoke-test-260423-graph-bridge.md`](./reports/smoke-test-260423-graph-bridge.md)
- Reuse: `src/agent/spec-classifier.ts` (classifyFile), `src/agent/spec-extractors/index.ts` (extractByClass)
- GitNexus TS wrappers: `src/agent/gitnexus-typed-wrappers.ts`, `src/agent/gitnexus-client.ts`

## ⚠️ Design Pivot (post Phase 0)

Original hypothesis (graph-walk from code symbol → process → spec) **disproved** — `.md` files have no edges to code symbols in GitNexus graph.

**Actual mechanism**: keyword search via `gitnexus_query` over indexed `Section` + `File` markdown nodes. The query API does BM25 match against `.md` heading text and filenames. `.md` paths surface in the `definitions[]` field of the query result.

This pivot changes the implementation but NOT the user-facing contract. Module name stays `intent-from-graph.ts`.

## Overview
- **Priority**: P0
- **Status**: completed
- **Effort**: S (<2h)
- **Description**: New module `intent-from-graph.ts` that takes diff context, queries GitNexus, harvests spec/doc paths, and returns `SpecFileEntry[]` ready for the existing extractor pipeline.

## Requirements

### Functional
- `collectSpecsFromGraph({baseRef, headRef, repoPath, prTitle?, changedSymbols?}) → Promise<SpecFileEntry[]>`
  - Build a single query string from PR title + top changed symbol names + feature-area path components (e.g., `face-scan` extracted from `apps/native/src/features/face-scan/...`)
  - Single `gitnexus_query` call (NOT per-file or per-symbol) — bounded latency
  - Harvest `.md` paths from the response's `definitions[]` (Section + File nodes whose `filePath` ends in `.md`)
  - Filter: glob match `INTENT_SCAN_PATHS` + excluded list (`INTENT_GRAPH_EXCLUDED` env, default `README.md,LICENSE,CONTRIBUTING.md`) + dedupe
  - Cap at `INTENT_GRAPH_MAX_SPECS` (default **2** — lowered from 3 per smoke test risk note)
  - Hint string: `via GitNexus query` for traceability
  - Confidence: `0.5` (lower than diff-detected, so truncation drops it earlier under pressure)
- `INTENT_GRAPH_BRIDGE=false` → returns `[]` immediately
- Graceful skip on any GitNexus error (log warning, return [])

### Non-Functional
- Single graph query call per review (NOT per file) — performance budget
- Total added latency ≤2s p95
- Module ≤100 LOC

## Architecture (revised post Phase 0)

```
intent-from-graph.ts
├─ collectSpecsFromGraph(input)        → SpecFileEntry[]
│   ├─ if !enabled → []
│   ├─ deriveQueryString(prTitle, changedFiles, changedSymbols) → string
│   ├─ gitnexus query: { query: <string>, limit: 5 }   ← one-shot
│   ├─ harvest paths from response.definitions[] where filePath endsWith '.md'
│   ├─ filter: scan-paths glob + excluded list + dedupe
│   ├─ classify each via classifyFile() (reuse Phase 2 from v0.3.0)
│   ├─ cap at MAX_SPECS (=2)
│   └─ return entries with confidence=0.5, hint='via GitNexus query'
└─ private helpers:
    ├─ deriveQueryString(title, files, symbols) → string
    │   Strategy: title + extracted feature-area path slugs + top 3 symbol basenames
    │   E.g. "Phase 06 MediaPipe Face Landmarker face-scan apps native modules face-landmarker"
    └─ extractMdPaths(queryResult) → string[]
```

The GitNexus client invocation should reuse the existing client from `src/agent/gitnexus-client.ts`. If the existing client wrapper doesn't expose the `query` operation, add a thin wrapper in `gitnexus-typed-wrappers.ts` first.

## Related Code Files

**Create:**
- `src/agent/intent-from-graph.ts`

**Read for reference:**
- `src/agent/gitnexus-typed-wrappers.ts` — existing typed query helpers
- `src/agent/gitnexus-tracer.ts` — pattern of one-shot per-review setup
- `src/agent/spec-classifier.ts` — `classifyFile` to reuse
- `src/agent/intent-collector.ts` — modify in Phase 2

## Implementation Steps

1. Read GitNexus typed wrapper signatures; pick the API confirmed in Phase 0.
2. Implement `deriveQueryFromDiff()` — concatenate top 3-5 changed symbol names or file basenames into a query string.
3. Implement `collectSpecsFromGraph()`:
   - Env switch + early return
   - Parallel-friendly (return Promise)
   - Wrap GitNexus call in try/catch; log + return [] on error
4. Apply filter chain: glob match (reuse `INTENT_SCAN_PATHS`) → excluded list → dedupe → cap.
5. Map each path to `SpecFileEntry` via `classifyFile()`; downgrade confidence to 0.5; annotate hint.
6. TypeScript compile clean.
7. Create `.changeset/intent-graph-bridge.md` (minor bump v0.4.0).

## Todo List
- [x] Read GitNexus typed wrappers, pick API
- [x] `deriveQueryFromDiff` helper
- [x] `collectSpecsFromGraph` main entry
- [x] Env switch `INTENT_GRAPH_BRIDGE`
- [x] Filter chain (scan-paths, excluded list, dedupe, cap)
- [x] Classify + downgrade confidence to 0.5
- [x] Graceful error handling (warn + return [])
- [x] TypeScript compile clean
- [x] Create `.changeset/intent-graph-bridge.md` (minor)

## Success Criteria
- Returns non-empty array on a known-good test PR (Phase 0 output)
- Returns [] on disabled env, graph error, or no matches
- Hint field shows `via GitNexus: ...` for downstream traceability

## Risk Assessment
- **Risk**: Query keyword too broad → noisy, returns LICENSE-style files
  - **Mitigation**: excluded list + cap + dedupe; confidence downgrade so they drop first under truncation
- **Risk**: GitNexus call slow on large repos
  - **Mitigation**: graceful timeout (rely on existing GITNEXUS_TIMEOUT_MS), one-shot

## Security Considerations
- All paths validated by existing `safeRead` / `isPathSafe` in extractors (Phase 3 reuse)
- No new shell exec paths

## Next Steps
- Unblocks Phase 2 (collector merge)
