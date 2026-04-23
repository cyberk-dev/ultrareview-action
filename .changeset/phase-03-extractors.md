---
'ultrareview-clone': minor
---

Add four spec extractors (`openspec`, `ck-plan`, `generic`, `changelog`) plus a router (`spec-extractors/index.ts`) that converts classified spec files into structured `ExtractedSpec` sections for prompt injection. Generic extractor honors `INTENT_GENERIC_HEADINGS` env override (Validation Session 1). All extractors are pure, never throw, and enforce per-file char budgets.
