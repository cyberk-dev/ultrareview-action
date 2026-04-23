# Phase 1 — Flow Diagram Module

## Context Links
- Plan: `./plan.md`
- Smoke test: prior session 13:53 — `gpt-5.4-mini` produces valid Mermaid in 7.6s, $0.0001/call on cyberk proxy
- Reuse: `src/services/ai-client.ts` (existing `chat()`)

## Overview
- **Priority**: P0
- **Status**: pending
- **Effort**: S (<2h)
- **Description**: Pure module that takes IMPACT GRAPH + INTENT + verified bugs context, asks a cheap LLM for a Mermaid `flowchart TD`, validates output, returns string or empty.

## Requirements

### Functional

`async function synthesizeFlowDiagram(input): Promise<string>`

**Input shape:**
```ts
type FlowDiagramInput = {
  changedFiles: string[]            // file paths in PR diff
  gitNexusSections: Map<string, string>  // per-file IMPACT GRAPH text
  intentSection?: string            // INTENT block (or undefined)
  verifiedBugs: Array<{ file: string; line: number; title: string; severity: string }>
}
```

**Behavior:**
- If `INTENT_FLOW_DIAGRAM=false` → return `''`
- If no IMPACT GRAPH AND no INTENT AND no verified bugs → return `''` (nothing meaningful to draw)
- Build prompt: union of changed-file basenames + extracted symbol names from IMPACT GRAPH (cap input ~3K chars) + bug locations
- Call `chat()` with `AI_FLOW_MODEL` (default `gpt-5.4-mini`), max_tokens=500, temperature=0.2
- Validate response with `validateMermaid()` — if invalid, return `''`
- On any error (LLM timeout, network, parse) → log warning, return `''`

### Validation rules
`validateMermaid(text: string): string | null`:
- Must contain ` ```mermaid` opening fence
- Must contain ` ``` ` closing fence
- Body must start with `flowchart TD` (other types rejected — anti-scope-creep)
- Total lines ≤ INTENT_FLOW_MAX_NODES + 10 buffer (default 20)
- Reject if body has unmatched brackets or backticks inside mermaid block
- Returns the FULL fenced block (with opening + closing fences) on pass; `null` on fail

### Prompt template

System:
```
You output ONLY a single Mermaid flowchart code block, nothing else.
Wrap it in triple backticks with `mermaid` language tag.
Use `flowchart TD` (top-down). No prose, no explanation, no other diagram types.
Use ONLY symbol names that appear in the provided IMPACT GRAPH or changed files.
Highlight changed symbols with `:::changed` or a classDef.
Maximum {MAX_NODES} nodes.
```

User:
```
Changed files in this PR:
- {file1}
- {file2}

IMPACT GRAPH excerpts (truncated):
{impact_graph_concat_capped_3k_chars}

Verified bugs (mark these locations on the diagram):
- {file}:{line} — {title} ({severity})

Generate the flowchart.
```

### Non-Functional
- Module ≤120 LOC
- Pure-ish: no side effects beyond the single `chat()` call
- Never throws; always returns string (possibly empty)
- Total latency budget: 10s p95

## Architecture

```
flow-diagram.ts
├─ synthesizeFlowDiagram(input)         → Promise<string>
│   ├─ if !enabled → ''
│   ├─ if input empty → ''
│   ├─ buildPrompt(input) → {system, user}
│   ├─ chat(... model: AI_FLOW_MODEL ...)
│   ├─ validateMermaid(response) → string | null
│   └─ return validated block or ''
├─ buildPrompt(input) → { system, user }
└─ validateMermaid(raw) → string | null
```

## Related Code Files

**Create:**
- `src/agent/flow-diagram.ts`

**Read for reference:**
- `src/agent/judge.ts` — pattern for env-mutation model swap (mirror it)
- `src/services/ai-client.ts` — `chat()` signature

## Implementation Steps

1. Read `judge.ts` to mirror env-mutation pattern: save `AI_MODEL`, set to `AI_FLOW_MODEL`, call, restore in finally.
2. Implement `validateMermaid()` first (pure, easy to unit test).
3. Implement `buildPrompt()` — focus on truncating IMPACT GRAPH to ≤3K chars while keeping per-file headers.
4. Implement `synthesizeFlowDiagram()` orchestrating the above.
5. Create `.changeset/flow-diagram.md` with **patch** bump and clear "feature delivered as patch" note.
6. TypeScript compile clean.

## Todo List
- [ ] `validateMermaid()` with regex + line-count check
- [ ] `buildPrompt()` with input truncation
- [ ] `synthesizeFlowDiagram()` env switch + chat call + validate + graceful skip
- [ ] Mirror env-mutation pattern from `judge.ts`
- [ ] TypeScript compile clean
- [ ] Create `.changeset/flow-diagram.md` (patch — explain feature-as-patch decision)

## Success Criteria
- Returns valid Mermaid block on a known-good input (manual test in Phase 5 smoke)
- Returns `''` on disabled env / empty input / invalid LLM output
- Module file ≤120 LOC
- No new dependencies

## Risk Assessment
- **Risk**: regex validator too strict → reject valid outputs
  - **Mitigation**: keep validator minimal (fence + flowchart prefix + line count); over-strict rejections are safer than broken diagrams
- **Risk**: env-mutation race condition (this AND judge run sequentially → no race here, just mutation cost)
  - **Mitigation**: documented elsewhere; OK for now
- **Risk**: prompt token bloat from huge IMPACT GRAPH
  - **Mitigation**: hard cap input at 3K chars before send

## Security Considerations
- Sanitize IMPACT GRAPH content before injecting into prompt (strip backticks/fences) — borrow from `intent-formatter.ts` `sanitize()` if straightforward; otherwise inline a small version

## Next Steps
- Unblocks Phase 2 (wire into pipeline + comment)
