# Phase 2 — Wire Step 7.5 + Embed in PR Comment

## Context Links
- Phase 1: `flow-diagram.ts` exports `synthesizeFlowDiagram()`
- Reuse: `src/agent/agent-loop.ts`, `src/github/pr-comments.ts`, `src/github/action-entry.ts`

## Overview
- **Priority**: P0
- **Status**: pending
- **Effort**: S (<1.5h)
- **Description**: Add Step 7.5 in agent-loop after judge & before filter. Pass diagram through `FleetResult` to `postPrReview()`. Prepend `<details>` block in `buildReviewSummary()`.

## Requirements

### Functional

**`agent-loop.ts` — Step 7.5:**
- After Step 7 (judge), before Step 8 (filter):
- Build `FlowDiagramInput` from existing pipeline state: `files` (changed), `gitNexusSections`, `intentSection`, `verifiedBugs` (from judgedBugs)
- Wrap call in `runStep('flow-diagram', ...)` for consistent progress reporting + error safety; fallback `''`
- Add to return value as new field `flowDiagram?: string`

**`mock-fleet.ts` (or wherever `FleetResult` is defined):**
- Extend `FleetResult` type with optional `flowDiagram?: string`

**`pr-comments.ts` — `buildReviewSummary()`:**
- Accept new optional param `flowDiagram?: string`
- If non-empty AND validates as Mermaid block → prepend a `<details>` block to summary:
  ```markdown
  <details>
  <summary>🤖 Bot's understanding (Mermaid flow)</summary>
  
  {flowDiagram block here, including ```mermaid fences}
  
  > ⚠️ This is the bot's interpretation. Verify against actual code before trusting bug analysis.
  </details>
  
  {existing summary content unchanged}
  ```
- If empty/null → existing summary unchanged (backward compat)

**`postPrReview()` (same file):**
- Accept `flowDiagram?: string` in options
- Pass through to `buildReviewSummary()`
- Apply to both: bugs-found path AND no-bugs LGTM path (LGTM should also show diagram so reviewer sees what bot examined)

**`action-entry.ts`:**
- Read `flowDiagram` from `FleetResult` returned by `runAgentLoop`
- Pass to `postPrReview({...existing, flowDiagram})`

### Non-Functional
- Step 7.5 latency budget: 10s p95 (synced with Phase 1)
- No regression on existing prompts/tests when `INTENT_FLOW_DIAGRAM=false`
- Snapshot stability: existing summary tests should continue to pass when `flowDiagram` is undefined

## Architecture

```
agent-loop.ts
  Step 7 judge
    ↓
  Step 7.5 [NEW] synthesizeFlowDiagram(...)  → flowDiagram: string
    ↓
  Step 8 filter
    ↓
  return { bugs, duration, flowDiagram }   ← extended

action-entry.ts
  const result = await runAgentLoop(...)
  await postPrReview({ ..., flowDiagram: result.flowDiagram })

pr-comments.ts
  buildReviewSummary(bugs, duration, flowDiagram?)
    if flowDiagram → prepend <details> block
    else → existing behavior
```

## Related Code Files

**Modify:**
- `src/agent/agent-loop.ts`
- `src/utils/mock-fleet.ts` (FleetResult type)
- `src/github/pr-comments.ts` (buildReviewSummary + postPrReview signatures)
- `src/github/action-entry.ts`

**Read for reference:**
- `src/agent/intent-collector.ts` — pattern for one-shot collection inserted between phases

## Implementation Steps

1. Extend `FleetResult` type in `mock-fleet.ts` with `flowDiagram?: string`. Run tsc to surface call sites.
2. In `agent-loop.ts`: import `synthesizeFlowDiagram`. Insert Step 7.5 between Step 7 and Step 8 using `runStep` wrapper. Add to return.
3. In `pr-comments.ts`: extend `buildReviewSummary(bugs, duration, flowDiagram?)`. Prepend `<details>` only when non-empty. Update `postPrReview()` signature + plumb through. Apply to both bug-list and LGTM paths.
4. In `action-entry.ts`: thread `result.flowDiagram` into `postPrReview` call.
5. Run `bunx tsc --noEmit` — fix any signature mismatches.
6. Run `bun test` — confirm zero regression. Existing pr-comments tests must continue to pass with `flowDiagram === undefined`.

## Todo List
- [ ] Extend `FleetResult.flowDiagram?` in mock-fleet.ts
- [ ] Add Step 7.5 in agent-loop.ts wrapped in `runStep`
- [ ] Extend `buildReviewSummary` signature + prepend `<details>` block
- [ ] Extend `postPrReview` options + apply to LGTM path too
- [ ] Thread through `action-entry.ts`
- [ ] TypeScript compile clean
- [ ] Existing tests stay green

## Success Criteria
- TypeScript compiles
- `INTENT_FLOW_DIAGRAM=false` → no extra LLM call, no comment change
- `INTENT_FLOW_DIAGRAM=true` + valid LLM output → `<details>` block appears at top of review summary
- LGTM path also includes diagram (anti-blind-spot — reviewer sees what bot looked at even when no bugs)

## Risk Assessment
- **Risk**: extending `FleetResult` breaks downstream consumers (eval runner, repl)
  - **Mitigation**: optional field; tsc will surface any required-field assumptions
- **Risk**: `<details>` block + GitHub Markdown quirk → diagram doesn't render inside collapsed
  - **Mitigation**: GitHub natively supports Mermaid in `<details>` (verified in 2024+); test on real PR in Phase 5

## Security Considerations
- Diagram body originates from LLM → already validated by Phase 1's regex check; no further sanitization needed since GitHub Mermaid renderer is sandboxed

## Next Steps
- Unblocks Phase 3 (tests)
