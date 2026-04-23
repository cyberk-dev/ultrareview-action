# Phase 0 — Smoke Test Decision Gate

## Context Links
- Brainstorm: `./reports/brainstorm-260423-1122-intent-graph-bridge.md`
- GitNexus tools available: `gitnexus_query`, `gitnexus_context`, `gitnexus_cypher`, `gitnexus_list_repos`
- v0.3.0 INTENT modules to extend: `src/agent/spec-classifier.ts`, `src/agent/spec-extractors/*`

## Overview
- **Priority**: P0 (BLOCKS plan)
- **Status**: completed
- **Effort**: S (≤30 min)
- **Description**: Manually validate that GitNexus query results actually surface useful spec/doc files for real PR diffs. KILL the plan if signal too weak.

## Requirements

### Functional
1. Verify `ultrareview-clone` symbols are reachable through workspace's GitNexus index (or sub-indexed separately).
2. Pick 3 PRs as test cases:
   - **PR1** — code-only diff (e.g., `src/agent/deep-analyzer.ts` change)
   - **PR2** — code + spec mix (e.g., a recent feature that touched both)
   - **PR3** — spec-only diff (e.g., docs/README update)
3. For each PR:
   - Identify changed symbols (use `git diff --name-only` + `gitnexus_detect_changes` or eyeball)
   - Run 1-2 of: `gitnexus_query({query: "<keyword>"})`, `gitnexus_context({name: "<symbol>"})`
   - Inspect returned `processes` / `process_symbols` for `.md` file paths NOT present in the diff
4. Score each PR: did graph traversal surface ≥1 spec file that's clearly relevant + not in diff?

### Decision Gate
- ✅ **≥1/3 score positive** → proceed to Phase 1
- ❌ **0/3 positive** → KILL plan
  - Mark plan.md `status: cancelled`
  - Write decision report `./reports/decision-260423-graph-bridge-killed.md`
  - Notify user: "v0.4.0 graph bridge killed; ship v0.3.0 only; consider Path A (RAG) in separate brainstorm"

## Open Questions to Answer in Phase 0

1. **Process participants** — Does `gitnexus_query` result include `.md` files or only code? Test with: `gitnexus_query({query: "intent injection"})` against `ultrareview-clone` (or workspace).
2. **Best query surface** — `query` (semantic), `context` (per-symbol), `cypher` (custom). Which has best signal-to-noise for spec retrieval?
3. **Confidence cue** — How to mark graph-derived entries in INTENT block (e.g., add `(via GitNexus)` suffix) without confusing existing truncation precedence?

Answers feed Phase 1 design.

## Implementation Steps

1. `gitnexus_list_repos` — confirm index exists for either `skin-agent-workspace` or `ultrareview-clone`. Index if missing.
2. Pick PRs from `git log --oneline -20 --merges` or recent `gh pr list --state merged --limit 10`.
3. For each PR:
   - `git diff --name-only <base>..<head>` to list changed files
   - Pick 2-3 changed code symbols
   - Run query → record output (paste into smoke-test report)
4. Write smoke test report to `./reports/smoke-test-260423-graph-bridge.md` with score table.
5. Apply decision gate.

## Todo List
- [x] Verify GitNexus index covers ultrareview-clone scope
- [x] Pick 3 representative PRs
- [x] Run graph queries per PR; capture output
- [x] Score each PR (positive / negative / unclear)
- [x] Write smoke test report
- [x] Apply gate: KILL or PROCEED to Phase 1 → PROCEED (1/3 positive)
- [x] Design pivot documented (keyword search via gitnexus_query, not graph-walk)

## Success Criteria
- Smoke test report saved at `./reports/smoke-test-260423-graph-bridge.md`
- Gate decision recorded in plan.md frontmatter (status updated)
- If proceeding: Phase 1 design unblocked with concrete query API choice + spec-path traversal pattern

## Risk Assessment
- **Risk**: GitNexus index doesn't include `.md` files at all → bridge impossible
  - **Mitigation**: First test reveals this in <5 min; KILL fast
- **Risk**: Queries return spec files but mostly irrelevant noise
  - **Mitigation**: Decision gate catches; do not paper over with filters

## Next Steps
- PROCEED → Phase 1 (build collector with chosen query API)
- KILL → Write decision report, ship v0.3.0 only
