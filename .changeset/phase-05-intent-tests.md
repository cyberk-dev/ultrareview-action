---
'ultrareview-clone': patch
---

Tests for intent injection: classifier (12 fixtures), per-class extractors (8 cases), formatter (10 cases incl. truncation precedence + backtick escape), `pr-meta-fetcher` (mocked `gh` binary, memoization, graceful null), and an end-to-end `collectIntent` integration smoke against a temp git repo. Generalize `mock-gitnexus-bin.ts` into a reusable `mock-cli-bin.ts` helper.
