---
'ultrareview-clone': patch
---

Fix flow-diagram step timing out on real PRs:

- Raise default LLM timeout from `15s` → `60s` (real-world cyberk-proxy LLM latency exceeded 15s on first production PR)
- Make timeout env-tunable via `INTENT_FLOW_TIMEOUT_MS`
- Tighten `IMPACT_GRAPH_BUDGET_CHARS` from `3000` → `1500` (smaller prompt = faster LLM thinking, cheaper, still enough context for a 5-10 node overview)
- Add diagnostic logs: `[flow-diagram] start model=… prompt=…b timeout=…ms` and `[flow-diagram] chat done elapsed=…ms output=…b` (or `chat failed after …ms` on timeout) so future debugging is data-driven
