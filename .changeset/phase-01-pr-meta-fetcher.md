---
'ultrareview-clone': patch
---

Add `pr-meta-fetcher` module to fetch PR title/body/labels and linked issues via `gh api`. Memoized per (owner, repo, prNumber); graceful null on missing/unauthenticated `gh` so analyzer proceeds without PR meta. Provides `resolveCurrentPR()` helper that reads `GITHUB_REPOSITORY` + `PR_NUMBER` env, falling back to `gh pr view`.
