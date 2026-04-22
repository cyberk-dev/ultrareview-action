---
"ultrareview-clone": minor
---

Bump GitNexus and workflow timeouts for large-graph / large-PR safety:

- `GITNEXUS_TIMEOUT_MS`: 10s → **30s** (per CLI call — accommodates cold queries on big graphs)
- `GITNEXUS_TRACER_BUDGET_MS`: 15s → **45s** (total per-file budget — one slow symbol no longer forces skip)
- Workflow `timeout-minutes`: 10-30 → **60** (fits medium/large PRs + cold index)

Users can still override via env for tighter CI if needed.
