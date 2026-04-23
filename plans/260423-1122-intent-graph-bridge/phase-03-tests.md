# Phase 3 — Tests

## Context Links
- Phase 1: `intent-from-graph.ts`
- Phase 2: modified `intent-collector.ts`
- Existing pattern: `src/__tests__/intent-integration.test.ts` (temp git repo)

## Overview
- **Priority**: P0 (blocks ship)
- **Status**: pending
- **Effort**: S (<2h)
- **Description**: Unit tests for `collectSpecsFromGraph` (mocked GitNexus client) + `mergeSpecEntries` dedupe + collector integration.

## Requirements

### Functional

**Unit — `src/__tests__/intent-from-graph.test.ts`:**
- `INTENT_GRAPH_BRIDGE=false` → returns []
- GitNexus error → returns [] + warning logged
- Successful query with mixed file types → only `.md` returned, capped at MAX
- Excluded list (README/LICENSE) filtered out
- Confidence downgraded to 0.5
- Hint string contains `via GitNexus`
- Path collision dedupe (when called from collector — covered in collector test)

**Integration — extend `src/__tests__/intent-integration.test.ts`:**
- New test case: stub `collectSpecsFromGraph` (or env-disable + spec-only path) to confirm collector still functions
- Verify dedupe: when same path returned by both `scanSpecFiles` and `collectSpecsFromGraph`, only ONE entry in formatted output

### Non-Functional
- Mock GitNexus via dependency injection or env-controlled disable (avoid spawning real CLI in tests)
- Total new test runtime <500ms

## Implementation Steps

1. Decide mock strategy:
   - Option A: env-disable in unit tests (simplest, doesn't exercise success path)
   - Option B: inject GitNexus client via parameter override (cleaner, tests success path)
   - **Recommendation**: B — refactor `collectSpecsFromGraph` to accept optional `client` param defaulting to real client.
2. Write unit tests with stubbed client returning fixture process data.
3. Extend integration test for dedupe + disabled-graph fallback.
4. Run full suite — confirm zero regression (still 205+ existing tests pass).

## Todo List
- [ ] Choose mock strategy + refactor signature if needed
- [ ] `intent-from-graph.test.ts` — 6 cases (disable, error, filter, exclude, confidence, hint)
- [ ] Extend `intent-integration.test.ts` for dedupe scenario
- [ ] `bun test` 100% pass (no regressions)

## Success Criteria
- All new tests pass
- Existing 205 tests stay green
- Branch coverage on new module ≥80%

## Risk Assessment
- **Risk**: Mock GitNexus client diverges from real shape
  - **Mitigation**: Type the mock against real client interface; reuse `gitnexus-typed-wrappers` types
- **Risk**: Integration test fragile to working dir / git refs
  - **Mitigation**: Reuse temp-repo pattern from existing integration test

## Next Steps
- Green tests unblock Phase 4 (docs)
