# Phase 4 — Docs

## Context Links
- Phases 1-3 complete
- Targets: README, action.yml, JSDoc on `flow-diagram.ts`, changeset

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: S (<45 min)

## Requirements

### Functional

**README addition** — append subsection inside `## Intent Injection (Optional)` (after the existing "Graph bridge (since v0.4.0)" subsection — note that subsection's title was named v0.4.0 but is actually shipped under v0.3.0; keep wording consistent):

```markdown
### Flow diagram (since v0.3.1)

When enabled, ultrareview asks a cheap LLM to draw a Mermaid `flowchart TD` summarizing the code paths it analyzed. The diagram appears at the **top** of the PR review summary in a collapsed `<details>` block — reviewer + author can verify the bot's interpretation in one glance, before reading the bug list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `INTENT_FLOW_DIAGRAM` | `true` | Opt-out switch |
| `AI_FLOW_MODEL` | `gpt-5.4-mini` | Cheap model for diagram synthesis (swap to `kimi-k2.5` / `glm-5` / `qwen3.5-plus` to experiment) |
| `INTENT_FLOW_MAX_NODES` | `10` | Cap diagram complexity for readability |

**Cost & latency** (per PR, default model on cyberk proxy):
- Cost: ~$0.0001 / PR
- Added latency: ~7-10s

**Caveat**: the diagram is the bot's *interpretation*, not ground truth. Always verify against actual code before trusting bug analysis. The collapsed `<details>` block includes this caveat inline.

**Smoke-test note** (April 2026): on `ai-proxy.cyberk.io`, `kimi-k2.5` showed 15x prompt-token overhead from cliproxy-injected context, making it 7-8x more expensive AND 1.7x slower than `gpt-5.4-mini` for this task. Default chosen accordingly. If your proxy doesn't have this overhead, swap freely.
```

**action.yml**:
- New input `flow-diagram-enabled` (default `'true'`, description)
- Pass `INTENT_FLOW_DIAGRAM: ${{ inputs.flow-diagram-enabled }}` in env block
- Update top-level description to mention "with bot's-understanding diagram"

**JSDoc on `src/agent/flow-diagram.ts`**:
> "Generates a Mermaid `flowchart TD` summarizing the bot's understanding of the PR's code paths. Embedded at the top of the PR review as a collapsed `<details>` block. Defaults to `gpt-5.4-mini` (cheapest viable on cyberk proxy per April-2026 smoke test). Graceful skip on every failure path."

**Changeset** `.changeset/flow-diagram.md`:
- Bump: **patch** (per user instruction; documented in plan.md why)
- Body explains feature + opt-out flag + cost/latency expectations
- Note: feature delivered as patch instead of minor for faster ship cycle and to bundle with v0.3.0 testing

### Non-Functional
- README addition ≤30 lines
- No broken links
- Changeset wording must NOT contradict reality (lessons learned from v0.3.0 release where one entry mentioned "v0.3.0 → v0.4.0" wrongly)

## Related Code Files

**Modify:**
- `README.md`
- `action.yml`
- `src/agent/flow-diagram.ts` — JSDoc header

**Create:**
- `.changeset/flow-diagram.md` (patch)

## Implementation Steps

1. Append "Flow diagram (since v0.3.1)" subsection to README after Graph bridge section.
2. Add `flow-diagram-enabled` input + env passthrough in action.yml.
3. Add JSDoc header to `flow-diagram.ts`.
4. Write changeset (patch bump) — clear wording, no version-string mistakes.

## Todo List
- [ ] README "Flow diagram" subsection
- [ ] Env var table (3 vars)
- [ ] Cost/latency note
- [ ] Caveat about bot interpretation
- [ ] action.yml input + env
- [ ] JSDoc on flow-diagram.ts
- [ ] `.changeset/flow-diagram.md` (patch, accurate wording)

## Success Criteria
- Reader can enable/configure flow diagram from README alone
- 3 new env vars documented with defaults + purpose
- Changeset doesn't contradict actual version bump
- Caveat about bot interpretation is prominent

## Risk Assessment
- **Risk**: changeset wording wrong again (like the v0.3.0 release where text said "v0.3.0 → v0.4.0" but actual was 0.2.0 → 0.3.0)
  - **Mitigation**: write changeset body to say "Adds flow-diagram step" without naming target version; let changesets do the math

## Next Steps
- Unblocks Phase 5 (release)
