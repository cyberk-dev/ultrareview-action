# Changelog

## 0.3.0

### Minor Changes

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`96a058f`](https://github.com/cyberk-dev/ultrareview-action/commit/96a058f18e4cf2059916cf5d020aeab51c0629b6) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Add `intent-from-graph` module that augments INTENT injection with related spec/doc files surfaced via GitNexus's keyword query (single shot per review). Reuses Phase 2 classifier + Phase 3 extractors from v0.3.0; runs alongside existing diff-detected spec scan and is deduped against it. Default on, opt-out via `INTENT_GRAPH_BRIDGE=false`. Capped at `INTENT_GRAPH_MAX_SPECS` (default 2). Excluded list via `INTENT_GRAPH_EXCLUDED` (default `README.md,LICENSE,CONTRIBUTING.md`). Bumps v0.3.0 → v0.4.0.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Add `spec-classifier` module that scans the PR diff for `.md` files under spec paths and classifies each as **OpenSpec / CK-Plan / Generic / Changelog / Unknown** with a confidence score. Glob-filtered via `INTENT_SCAN_PATHS`; whole subsystem can be disabled or forced via `INTENT_CLASSIFIER`. Memoized per `base..head` and uses sibling lookups (`proposal.md`, `tasks.md`, `phase-*.md`) to score confidence.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Add four spec extractors (`openspec`, `ck-plan`, `generic`, `changelog`) plus a router (`spec-extractors/index.ts`) that converts classified spec files into structured `ExtractedSpec` sections for prompt injection. Generic extractor honors `INTENT_GENERIC_HEADINGS` env override (Validation Session 1). All extractors are pure, never throw, and enforce per-file char budgets.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Inject a new `=== PR INTENT ===` section at the **top** of the deep-analyzer prompt. Composed once per review by `intent-collector` (PR meta + classified spec files) and threaded through `analyzeAllFiles` / `analyzeFile` / `buildAnalyzerPrompt` so analyzer reasoning frames every file around what the PR should achieve, not just what the diff shows. Truncates by precedence (unknown → generic → CK-Plan PHASES → OpenSpec CAPABILITIES → PR body) within `INTENT_BUDGET_CHARS` (default 4000). Empty when no PR meta + no specs, leaving v0.2.0 prompt snapshots unchanged.

### Patch Changes

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Add `pr-meta-fetcher` module to fetch PR title/body/labels and linked issues via `gh api`. Memoized per (owner, repo, prNumber); graceful null on missing/unauthenticated `gh` so analyzer proceeds without PR meta. Provides `resolveCurrentPR()` helper that reads `GITHUB_REPOSITORY` + `PR_NUMBER` env, falling back to `gh pr view`.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Tests for intent injection: classifier (12 fixtures), per-class extractors (8 cases), formatter (10 cases incl. truncation precedence + backtick escape), `pr-meta-fetcher` (mocked `gh` binary, memoization, graceful null), and an end-to-end `collectIntent` integration smoke against a temp git repo. Generalize `mock-gitnexus-bin.ts` into a reusable `mock-cli-bin.ts` helper.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Document Intent injection: new `## Intent Injection (Optional)` section in README (supported formats, env vars, action input, example output, troubleshooting), new `intent-enabled` input on `action.yml`, top-level action description updated, and JSDoc headers on `intent-collector` + `spec-classifier`.

- [#3](https://github.com/cyberk-dev/ultrareview-action/pull/3) [`7eab926`](https://github.com/cyberk-dev/ultrareview-action/commit/7eab926b99999829e9f339f8ca984f0b3497c32d) Thanks [@TuNbCyberk](https://github.com/TuNbCyberk)! - Add `scripts/prepare-release.sh` — idempotent helper that consolidates pending changesets, bumps `package.json`, opens a Version PR, and prints merge instructions. Bypasses the cyberk-dev Actions-PR block by opening the PR locally; the merge workflow still handles tagging + GH release. Supports `--dry-run`. README's Versioning section adds a "Maintainer release flow" subsection documenting it.

All notable changes to `ultrareview-clone` documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes landed yet — see `.changeset/*.md` for in-flight entries._

<!--
  Format note: entries from v0.2.0 onward are auto-generated by changesets
  (flat bullet list linking each PR). The v0.1.0 section is hand-authored in
  Keep a Changelog style. Both coexist; do not reformat on merge.
-->

## [0.2.0] — 2026-04-23

GitNexus graph integration + timeout safety bumps.

### Added

- **GitNexus CLI client** (`gitnexus-client.ts`, `gitnexus-typed-wrappers.ts`) — health check + typed accessors `cypher`, `context`, `impact`, `query`, `routeMap`, `shapeCheck`. Graceful skip via `GITNEXUS_ENABLED=false`.
- **Tracer core** (`gitnexus-tracer.ts`, `gitnexus-diff.ts`, `gitnexus-process-resolver.ts`, `gitnexus-symbol-fan-out.ts`) — derives changed symbols via `git diff` + Cypher + hunk overlap; parallel fan-out to callers/callees/impact/process chains per symbol.
- **IMPACT GRAPH prompt section** (`gitnexus-formatter.ts`) — injected into deep-analyzer between CALLERS and ADDITIONAL CONTEXT. 3K per-file budget with tiered truncation (extras → process middle → 2nd process → callees → symbols).
- **End-to-end process chain injection** with `← CHANGED` marker per symbol — anti-hallucination signal exposing execution flow.
- **CI integration** (`action.yml`, `.github/workflows/ultrareview.yml`, `examples/ultrareview-workflow.yml`, `scripts/init.sh`) — `actions/cache@v4` for `.gitnexus/` (v1-prefixed key), `gitnexus analyze --incremental` step with `continue-on-error`, optional secret-scan step.
- **Test suite** — 48 GitNexus tests: unit (client, diff, formatter, tracer), integration (env-guarded), benchmark scaffold. Shell-stub mock binary for deterministic tests.
- **Documentation** — README `## GitNexus Integration` section with setup, 7 env vars table, action inputs, 6-item troubleshooting, example IMPACT GRAPH output.

### Changed

- **Timeouts bumped** for monorepo / large-PR safety:
  - `GITNEXUS_TIMEOUT_MS`: 10s → **30s** (per CLI call)
  - `GITNEXUS_TRACER_BUDGET_MS`: 15s → **45s** (per-file total)
  - Workflow `timeout-minutes`: 10-30 → **60**

### Deferred

- `routeMap()` / `shapeCheck()` return `[]` with warning — CLI commands not exposed (MCP-only in current GitNexus). Structure, heuristics, types, formatter, truncation all wired; populate when upstream CLI ships these commands.

## [0.1.0] — 2026-04-22

First tagged baseline. Prior commits distributed via git SHA pinning.

### Added

- REPL with `/review` and `/ultrareview` commands (interactive PR review)
- Non-interactive CLI mode (`--print`, `-r`, `-g` flags)
- 7-step agent loop: gather → pre-analyze → analyze → classify → verify → judge → filter
- Pre-analysis tracers: async-tracer, schema-analyzer, deletion-detector
- BugHunter pipeline posting line-level PR comments (severity-aware)
- GitHub Action entry (`src/github/action-entry.ts`) for PR event triggers
- Quota gate (free / exhausted / low / confirm)
- Tool interface (`buildTool()` + Zod schema) — foundation for future tools
- Model routing: analysis / classify / judge split across configured models
- Ink terminal UI (REPL, spinner, overage dialog, structured result)

### Infrastructure

- Bun runtime, TypeScript, Zod schemas
- Conventional-commits-compatible (adopted via changesets)

## Maintainer notes

- Every PR that changes user-visible behavior must include a changeset entry (`bun run changeset`).
- Release workflow (`.github/workflows/release.yml`) opens a "Version Packages" PR on each merge to `main` that has changesets.
- Merging the Version PR tags git + creates a GitHub Release.

[Unreleased]: https://github.com/cyberk-dev/ultrareview-action/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/cyberk-dev/ultrareview-action/releases/tag/v0.2.0
[0.1.0]: https://github.com/cyberk-dev/ultrareview-action/releases/tag/v0.1.0
