---
'ultrareview-clone': minor
---

Add `intent-from-graph` module that augments INTENT injection with related spec/doc files surfaced via GitNexus's keyword query (single shot per review). Reuses Phase 2 classifier + Phase 3 extractors from v0.3.0; runs alongside existing diff-detected spec scan and is deduped against it. Default on, opt-out via `INTENT_GRAPH_BRIDGE=false`. Capped at `INTENT_GRAPH_MAX_SPECS` (default 2). Excluded list via `INTENT_GRAPH_EXCLUDED` (default `README.md,LICENSE,CONTRIBUTING.md`). Bumps v0.3.0 → v0.4.0.
