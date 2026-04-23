# Phase 2 — Collector Merge + Dedupe

## Context Links
- Phase 1: `intent-from-graph.ts` exposes `collectSpecsFromGraph()`
- Reuse: `src/agent/intent-collector.ts` (existing orchestrator)

## Overview
- **Priority**: P0
- **Status**: pending
- **Effort**: S (<1h)
- **Description**: Wire `collectSpecsFromGraph` into `intent-collector.ts` parallel with `scanSpecFiles`. Dedupe by path before extractor pipeline. No formatter changes (formatter already merges via existing `extracted` array).

## Requirements

### Functional
- In `collectIntent()`:
  - Run `scanSpecFiles()` (existing) and `collectSpecsFromGraph()` (Phase 1) via `Promise.allSettled`
  - Concat both `SpecFileEntry[]` arrays
  - Dedupe by `entry.path` — keep entry with HIGHER confidence (diff-detected wins over graph-derived)
  - Pass deduped list to existing extractor + formatter pipeline
- Behavior preserved when graph bridge disabled or returns []

### Non-Functional
- No new prompt-format changes (graph entries flow through same `formatSpecBlock`)
- Truncation precedence already handles low-confidence entries (graph entries downgraded to confidence=0.5 in Phase 1)

## Architecture

```
intent-collector.ts (existing, modified):
  collectIntent({...}):
    Promise.allSettled([
      scanSpecFiles(...)              // existing
      collectSpecsFromGraph(...)      // NEW
      fetchPRMeta(...)                // existing
    ])
    ↓
    mergeSpecEntries(diffEntries, graphEntries) → dedupedEntries
    ↓
    extractByClass per entry (existing)
    ↓
    formatIntentSection(prMeta, extracted, budget) (existing)
```

## Related Code Files

**Modify:**
- `src/agent/intent-collector.ts` — add third Promise, add `mergeSpecEntries` helper

## Implementation Steps

1. Import `collectSpecsFromGraph` from `./intent-from-graph.ts`.
2. Add helper `mergeSpecEntries(a: SpecFileEntry[], b: SpecFileEntry[]): SpecFileEntry[]`:
   - Map by path
   - On collision: keep higher confidence
3. Update `Promise.allSettled` to add graph collection.
4. After both settle: merge → continue with existing extractor loop.
5. Verify TypeScript compile clean.
6. Run existing test suite — must remain 205 pass / 0 fail (graph bridge defaults to true but tests don't have a real GitNexus, so it should gracefully return []).

## Todo List
- [ ] Add `mergeSpecEntries` helper
- [ ] Wire `collectSpecsFromGraph` into Promise.allSettled
- [ ] Dedupe + confidence prefer logic
- [ ] TypeScript compile clean
- [ ] Existing tests still pass (no regression)

## Success Criteria
- `collectIntent` returns formatted block including graph-derived entries on real PR
- Existing diff-detected entry wins over graph entry on path collision
- Tests stay green with no test changes (graph bridge graceful skip in test env)

## Risk Assessment
- **Risk**: Dedupe loses metadata (e.g., graph `hint` overwrites diff `hint` if logic inverted)
  - **Mitigation**: Higher confidence wins → diff `hint` retained; graph entries only added when path NOT already in diff
- **Risk**: Test environment has GitNexus query that times out / fails
  - **Mitigation**: Phase 1 graceful skip on error → []; tests unaffected

## Next Steps
- Unblocks Phase 3 (tests)
