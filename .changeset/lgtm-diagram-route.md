---
'ultrareview-clone': patch
---

Fix flow diagram missing from LGTM PR comments (no-bug PRs).

**Root cause**: `action-entry.ts` had a hardcoded LGTM bypass that posted a plain comment via `gh pr comment` directly when `result.bugs.length === 0`, skipping `postPrReview()` entirely — so the flow-diagram embed added in v0.3.1 only reached PRs with surviving bugs. In production this was most PRs, since the filter step typically drops a large share of low-confidence bugs.

**Fix**: remove the `if (bugs > 0) … else …` gate; always route through `postPrReview()`, which already handles both bug-list and LGTM cases with the diagram embed. Feedback-dataset save remains gated to `bugs > 0` (don't bloat dataset with empty entries).

Side effect: LGTM wording is now "No bugs found in this diff. Looks good to me!" (was "LGTM! No bugs detected by the automated review pipeline."). Equivalent meaning.

Also extracts `buildLgtmBody(flowDiagram?)` so the LGTM path is unit-testable (regression covered).
