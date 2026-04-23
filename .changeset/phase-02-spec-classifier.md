---
'ultrareview-clone': minor
---

Add `spec-classifier` module that scans the PR diff for `.md` files under spec paths and classifies each as **OpenSpec / CK-Plan / Generic / Changelog / Unknown** with a confidence score. Glob-filtered via `INTENT_SCAN_PATHS`; whole subsystem can be disabled or forced via `INTENT_CLASSIFIER`. Memoized per `base..head` and uses sibling lookups (`proposal.md`, `tasks.md`, `phase-*.md`) to score confidence.
