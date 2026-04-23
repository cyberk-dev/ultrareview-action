---
'ultrareview-clone': minor
---

Inject a new `=== PR INTENT ===` section at the **top** of the deep-analyzer prompt. Composed once per review by `intent-collector` (PR meta + classified spec files) and threaded through `analyzeAllFiles` / `analyzeFile` / `buildAnalyzerPrompt` so analyzer reasoning frames every file around what the PR should achieve, not just what the diff shows. Truncates by precedence (unknown → generic → CK-Plan PHASES → OpenSpec CAPABILITIES → PR body) within `INTENT_BUDGET_CHARS` (default 4000). Empty when no PR meta + no specs, leaving v0.2.0 prompt snapshots unchanged.
