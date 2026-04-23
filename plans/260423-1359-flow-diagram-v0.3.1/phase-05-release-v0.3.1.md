# Phase 5 — Release v0.3.1

## Context Links
- All prior phases complete
- Existing release infra: `scripts/prepare-release.sh`, `.github/workflows/release.yml`
- Known constraint: cyberk-dev org blocks Actions creating PRs → manual Version PR step

## Overview
- **Priority**: P1 (ship gate)
- **Status**: pending
- **Effort**: S (≤30 min)

## Requirements

### Functional
1. After Phases 1-4 merged to main:
   - Changeset workflow auto-builds branch `changeset-release/main` with version bump (`0.3.0 → 0.3.1`)
   - That workflow's `gh pr create` step fails (org block) — but the BRANCH is pushed and ready
2. Manually open Version PR for `changeset-release/main`:
   ```bash
   gh pr create -R cyberk-dev/ultrareview-action \
     --base main --head changeset-release/main \
     --title "chore(release): v0.3.1" \
     --body "Auto-generated. Adds flow-diagram synthesis step (opt-out via INTENT_FLOW_DIAGRAM=false)."
   ```
3. Verify CI on the Version PR (Tests + Release workflows)
4. Merge → workflow tags `v0.3.1` + creates GH release with `[0.3.1]` CHANGELOG section
5. Post-verify: `gh release view v0.3.1`

### Pre-merge smoke check (recommended)
Before opening Version PR, sanity-test on a real PR:
- Either let the feature PR (Phase 1-4) run ultrareview self-review on itself → check the PR comment for the `<details>` block + valid Mermaid render
- OR locally invoke action-entry against a real PR with `INTENT_FLOW_DIAGRAM=true` set

If diagram is broken or not present → fix before tagging.

### Consumer integration (post-tag)
- Bump `skin-agent-fe` workflow pin from `@v0.3.0` → `@v0.3.1` (manual or Dependabot Mon)
- Test cả 2 features cùng lúc: INTENT v0.3.0 + flow diagram v0.3.1

## Implementation Steps

1. **Wait** for feature PR (Phases 1-4) to merge into ultrareview-action `main`
2. Wait for `Release` workflow to push `changeset-release/main` (will fail at PR create, expected)
3. `gh pr create` Version PR manually (per command above)
4. Watch checks: `gh pr checks <N> -R cyberk-dev/ultrareview-action`
5. Self-review: confirm CHANGELOG entry says "0.3.1" (NOT 0.4.0 — patch bump)
6. Merge Version PR
7. Verify tag: `gh release view v0.3.1 -R cyberk-dev/ultrareview-action`
8. Bump consumer pin in `skin-agent-fe`

## Todo List
- [ ] Feature PR merged
- [ ] `changeset-release/main` branch built by workflow
- [ ] Manually open Version PR
- [ ] Verify Tests workflow on Version PR passes
- [ ] Verify CHANGELOG version bump is correct (0.3.0 → 0.3.1)
- [ ] Merge Version PR
- [ ] Verify `gh release view v0.3.1`
- [ ] Bump `skin-agent-fe` workflow pin

## Success Criteria
- `git tag` shows `v0.3.1` after merge
- GH release page exists with `[0.3.1]` CHANGELOG section
- `.changeset/flow-diagram.md` has been consumed (deleted from main)
- skin-agent-fe pin bumped (or Dependabot scheduled)

## Risk Assessment
- **Risk**: changeset arithmetic wrong (e.g., produces 0.4.0 instead of 0.3.1 because patch entry was authored incorrectly)
  - **Mitigation**: changeset entry must specify `'ultrareview-clone': patch` exactly. Verify before merge by viewing PR diff.
- **Risk**: Version PR conflicts with concurrent changes on main
  - **Mitigation**: low concurrency; if conflict, rebase manually or close + re-trigger
- **Risk**: Feature breaks on real PR (Mermaid render fail, latency spike, etc.)
  - **Mitigation**: pre-merge smoke test step above; INTENT_FLOW_DIAGRAM=false hot-disable if discovered post-ship

## Security Considerations
- No new secrets needed
- Reuses existing `AI_API_KEY` — no exposure change

## Next Steps (post-v0.3.1)
- Monitor 5+ real PRs to gather hit-rate signal on:
  - Diagram quality (does it render? does it match the actual flow?)
  - Reviewer feedback (does it actually help?)
  - Latency p95 (is it really ≤10s?)
- If <30% of PRs produce useful diagram → v0.3.2 patch flip default OFF
- If quality good but model swap could be cheaper → v0.3.2 try `claude-haiku-4-5` benchmark
