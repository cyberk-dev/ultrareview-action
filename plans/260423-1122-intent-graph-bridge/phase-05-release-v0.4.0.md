# Phase 5 — Release v0.4.0

## Context Links
- Phases 1-4 complete + merged to main
- Existing release infra from v0.3.0: `scripts/prepare-release.sh`, `.github/workflows/release.yml`

## Overview
- **Priority**: P1 (ship gate)
- **Status**: pending
- **Effort**: S (≤30 min, mostly waiting)

## Requirements

### Functional
1. After phases 1-4 are merged: smoke-verify INTENT block on 1 real PR (manual + log inspection)
2. Run `./scripts/prepare-release.sh --dry-run` → review diff
3. Run `./scripts/prepare-release.sh` → opens Version PR (v0.3.0 → v0.4.0)
4. Review + merge Version PR
5. Verify workflow tags `v0.4.0` + creates GH release with `[0.4.0]` CHANGELOG section
6. Optional: bump consumer (`skin-agent-fe` workflow pin) to `@v0.4.0` if not auto-handled by Dependabot

### Non-Functional
- Same flow as v0.3.0 — no new infra, script already exists

## Implementation Steps

1. Smoke verify locally:
   ```bash
   GITHUB_REPOSITORY=cyberk-dev/ultrareview-clone PR_NUMBER=<id> bun run src/github/action-entry.ts
   ```
   Confirm INTENT block in stdout includes `via GitNexus` annotated entry.
2. `./scripts/prepare-release.sh --dry-run`
3. `./scripts/prepare-release.sh`
4. Review Version PR diff (CHANGELOG `[0.4.0]` section + `package.json` bump)
5. Merge → workflow runs → tag + GH release
6. `gh release view v0.4.0` to confirm

## Todo List
- [ ] Smoke verify INTENT graph bridge on 1 real PR
- [ ] `prepare-release.sh --dry-run`
- [ ] `prepare-release.sh` (real run)
- [ ] Review + merge Version PR
- [ ] Verify `gh release view v0.4.0`
- [ ] Bump skin-agent-fe pin (manual or via Dependabot)

## Success Criteria
- `git tag` shows `v0.4.0`
- GH release page exists with `[0.4.0]` CHANGELOG as notes
- `.changeset/` empty except `README.md` + `config.json`

## Risk Assessment
- **Risk**: Smoke-verify reveals graph bridge mis-fires on real PR
  - **Mitigation**: Roll back via PR revert; investigate; do not ship until clean
- **Risk**: Existing release workflow regression
  - **Mitigation**: Already tested in v0.3.0

## Next Steps
- Post-v0.4.0: monitor 1 week of real PRs for INTENT-graph quality
- If `INTENT_GRAPH_MAX_SPECS=3` causes block bloat → tune in patch
- Consider Plan B benchmark (compare v0.3.0 vs v0.4.0 detection rate)
