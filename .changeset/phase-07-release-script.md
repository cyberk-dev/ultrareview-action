---
'ultrareview-clone': patch
---

Add `scripts/prepare-release.sh` — idempotent helper that consolidates pending changesets, bumps `package.json`, opens a Version PR, and prints merge instructions. Bypasses the cyberk-dev Actions-PR block by opening the PR locally; the merge workflow still handles tagging + GH release. Supports `--dry-run`. README's Versioning section adds a "Maintainer release flow" subsection documenting it.
