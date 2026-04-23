---
'ultrareview-clone': patch
---

Add `flow-diagram` step that asks a cheap LLM to produce a Mermaid `flowchart TD` summarizing the bot's understanding of the PR's code paths. The diagram is embedded at the **top** of the PR review summary inside a collapsed `<details>` block so reviewer + author can verify the bot's interpretation in one glance — before reading the bug list.

Defaults: opt-out via `INTENT_FLOW_DIAGRAM=false`. Default model `gpt-5.4-mini` (swap freely via `AI_FLOW_MODEL`). Caps node count via `INTENT_FLOW_MAX_NODES` (default 10). Reuses existing `AI_API_KEY` and `AI_BASE_URL` — no new secrets. Cost ~$0.0001/PR; latency ~7-10s. Graceful skip on env-disable, empty input, LLM error, or invalid Mermaid output (no broken comments posted).

Also fix a pre-existing bug in `ai-client.ts` where `AI_MODEL` was captured at module-load time, making the env-mutation pattern in judge/classifier/analyzer ineffective. The same pattern now actually swaps the model.

Feature delivered as **patch** (rather than minor) to bundle with v0.3.0 testing and ship faster — the change is purely additive and opt-out.
