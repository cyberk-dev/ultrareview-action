# Phase 4 — Docs

## Context Links
- Code shipped Phases 1-3
- Target: README "Intent Injection" section + JSDoc on new module + changeset

## Overview
- **Priority**: P1
- **Status**: completed
- **Effort**: S (<1h)

## Requirements

### Functional

**README addition** — append subsection inside existing `## Intent Injection (Optional)`:

```markdown
### Graph bridge (since v0.4.0)

When GitNexus is enabled, INTENT also surfaces spec/doc files **not in the diff** by walking the code graph from changed symbols. Example: a PR touching `src/auth/validator.ts` may auto-include `docs/auth-architecture.md` in the prompt even when the doc isn't part of the commit.

Knobs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `INTENT_GRAPH_BRIDGE` | `true` | Enable/disable graph-derived spec retrieval |
| `INTENT_GRAPH_MAX_SPECS` | `3` | Cap related specs per review |
| `INTENT_GRAPH_EXCLUDED` | `README.md,LICENSE,CONTRIBUTING.md` | Comma-separated noise filter |
```

**JSDoc** on `intent-from-graph.ts`:
> "Augments INTENT with spec/doc paths reached by traversing GitNexus process graphs from changed code symbols. Confidence downgraded so diff-detected specs win on collision."

**Changeset** `.changeset/intent-graph-bridge.md`:
- Bump: minor (v0.3.0 → v0.4.0)
- Note that graph bridge is opt-out (default on) and reuses existing GitNexus integration

### Non-Functional
- README addition ≤30 lines
- No broken links

## Related Code Files

**Modify:**
- `README.md`
- `src/agent/intent-from-graph.ts` — JSDoc header

**Create:**
- `.changeset/intent-graph-bridge.md`

## Implementation Steps

1. Append subsection to README's `## Intent Injection (Optional)` section.
2. Add JSDoc header to `intent-from-graph.ts`.
3. Write changeset (minor bump).

## Todo List
- [x] README graph-bridge subsection
- [x] Env var table additions (3 new vars)
- [x] JSDoc on `intent-from-graph.ts`
- [x] `.changeset/intent-graph-bridge.md`

## Success Criteria
- Reader can enable/disable graph bridge from README alone
- All 3 new env vars documented with defaults
- Changeset follows existing format

## Risk Assessment
- **Risk**: Docs drift from code
  - **Mitigation**: Single short subsection; env table near impl

## Next Steps
- Unblocks Phase 5 (release)
