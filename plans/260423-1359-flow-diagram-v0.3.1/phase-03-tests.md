# Phase 3 — Tests

## Context Links
- Phase 1 module: `flow-diagram.ts`
- Phase 2 wiring: `agent-loop.ts`, `pr-comments.ts`
- Existing patterns: `src/__tests__/intent-formatter.test.ts` (pure function tests), `src/__tests__/intent-from-graph.test.ts` (env-driven graceful skip tests)

## Overview
- **Priority**: P0 (ship gate)
- **Status**: pending
- **Effort**: S (<1.5h)
- **Description**: Cover validator (pure regex), prompt builder (pure), graceful skip paths (env-disable, empty input, LLM failure mock), and pr-comments embed.

## Requirements

### Functional

**Unit — `src/__tests__/flow-diagram.test.ts`:**

`validateMermaid()` cases:
- Valid `flowchart TD` block → returns full block
- Valid block but type is `sequenceDiagram` → returns null (anti-scope-creep)
- Missing closing fence → null
- No fence at all → null
- Unbalanced backticks inside body → null
- Exceeds line cap → null
- Empty input → null

`buildPrompt()` cases:
- Includes only changed file basenames + IMPACT GRAPH excerpts
- Truncates IMPACT GRAPH to 3K chars (verify cap with synthetic 10K input)
- No verified bugs → bug section omitted (or marked "none")

`synthesizeFlowDiagram()` graceful-skip cases:
- `INTENT_FLOW_DIAGRAM=false` → returns ''
- All inputs empty (no changed files, no graph, no intent, no bugs) → returns ''
- Mocked `chat()` throws → returns '' (no throw, warning logged)
- Mocked `chat()` returns invalid Mermaid → returns ''
- Mocked `chat()` returns valid Mermaid → returns the validated block

**Mock strategy:**
- Inject `chat` via dependency parameter override (cleaner than env-mutation tests). Refactor `synthesizeFlowDiagram` to accept optional `chatFn` for tests.
  - Default: real `chat` from `ai-client.ts`
  - Test: pass a stub `chatFn` returning canned responses
- Avoids spawning a real subprocess + makes tests deterministic <100ms

**Integration — `src/__tests__/pr-comments.test.ts` (extend if exists, or new):**
- `buildReviewSummary(bugs, duration, undefined)` → existing format unchanged (snapshot)
- `buildReviewSummary(bugs, duration, validMermaidBlock)` → starts with `<details>` block + caveat + then existing summary
- `buildReviewSummary([], duration, validMermaidBlock)` → LGTM path also includes diagram

### Non-Functional
- All new tests <500ms total
- No real `chat()` call in tests
- Coverage on new module ≥85%

## Implementation Steps

1. Refactor `synthesizeFlowDiagram(input, chatFn?)` signature to accept optional `chatFn` for testing.
2. Write `flow-diagram.test.ts` — start with `validateMermaid` (purest, easiest), then `buildPrompt`, then orchestrator with stub chat.
3. Extend or create `pr-comments.test.ts` with 3 cases (no diagram, with diagram, LGTM with diagram).
4. Run `bun test` — all 216 prior + new must pass.

## Todo List
- [ ] Refactor `synthesizeFlowDiagram` to accept `chatFn?`
- [ ] `validateMermaid` test cases (≥7)
- [ ] `buildPrompt` test cases (≥3)
- [ ] `synthesizeFlowDiagram` orchestrator tests (≥5, including graceful skip)
- [ ] `pr-comments` snapshot/structural tests for diagram embedding
- [ ] `bun test` 100% pass

## Success Criteria
- All new tests pass
- Existing 216 tests stay green (zero regression)
- Coverage on `flow-diagram.ts` ≥85%

## Risk Assessment
- **Risk**: snapshot fragility on `pr-comments` — minor format tweak breaks tests
  - **Mitigation**: prefer structural assertions (e.g., `expect(out).toMatch(/<details>/)`) over full string snapshots
- **Risk**: dependency-injection refactor leaks test concern into production signature
  - **Mitigation**: optional param with default = real `chat`; production callers don't pass it; type unchanged from outside

## Next Steps
- Unblocks Phase 4 (docs)
