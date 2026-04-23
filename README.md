# Ultrareview Clone

Clone of Claude Code's /ultrareview command — Bun + Ink + TypeScript interactive CLI.

## Quick Start (Any Repo)

### One-command setup

```bash
# cd into your repo, then:
bash <(curl -fsSL https://raw.githubusercontent.com/cyberk-dev/ultrareview-action/main/scripts/init.sh)
```

This will:
1. Create `.github/workflows/ultrareview.yml` (pinned to latest SHA)
2. Check if `AI_API_KEY` secret is set
3. Show next steps

### Manual setup

Add `.github/workflows/ultrareview.yml`:

```yaml
name: Ultrareview
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: cyberk-dev/ultrareview-action@v0.1.0
        with:
          ai-api-key: ${{ secrets.AI_API_KEY }}
```

Then set secrets:
```bash
gh secret set AI_API_KEY --repo your-org/your-repo
gh secret set AI_BASE_URL --repo your-org/your-repo  # optional
```

See [`examples/ultrareview-workflow.yml`](./examples/ultrareview-workflow.yml) for full example with optional overrides.

## Setup

```bash
bun install
```

## Usage

```bash
# Launch interactive REPL
bun run src/main.tsx

# Launch with initial command
bun run src/main.tsx /review 123        # Review PR #123 (local AI via cliproxy)
bun run src/main.tsx /ultrareview 42    # Full bug hunt on PR #42
bun run src/main.tsx /ultrareview       # Bug hunt on current branch vs main
```

Inside the REPL:

```
/help               Show available commands
/review <PR#>       Quick review — fetches PR diff, streams AI response
/ultrareview <PR#>  Deep review — 3-agent fleet, structured bug report
/ur <PR#>           Alias for /ultrareview
/exit               Exit
```

## Environment Variables

```env
AI_BASE_URL=https://your-ai-proxy.example.com   # AI proxy base URL
AI_API_KEY=your-api-key-here                     # API key (required, no default)
AI_MODEL=gpt-5.4-mini                            # Model (default: gpt-5.4-mini)
MOCK_QUOTA=free|exhausted|low|confirm    # Simulate quota state for testing
```

## Architecture

Mirrors FavAI/Claude Code patterns:

| Pattern | Implementation |
|---|---|
| Tool interface | `buildTool()` + Zod schema in `src/tools/` |
| Command system | `prompt` + `local-jsx` types in `src/commands/` |
| Permission gate | 4-state quota: free / exhausted / low / needs-confirm |
| Remote task polling | `startRemoteTaskPolling()` in `src/tasks/remote-task.ts` |
| BugHunter fleet | 3 parallel cliproxy calls (security / logic / edge-cases) |
| Ink UI | REPL + spinner + overage dialog + structured result |

### BugHunter Fleet

The `/ultrareview` command runs 3 specialized AI agents in parallel:

1. **Security agent** — SQL injection, XSS, auth bypasses, secret leaks, SSRF
2. **Logic agent** — race conditions, null derefs, off-by-one, wrong conditionals
3. **Edge-cases agent** — missing validation, boundary conditions, Unicode issues

Results are merged, deduplicated, and sorted by severity (critical > high > medium > low).

## GitHub Action

Add to your repo's `.github/workflows/ultrareview.yml` (copy from this project).

### Required Secrets

- `AI_API_KEY` — Cliproxy API key
- `AI_BASE_URL` (optional) — AI proxy URL (default: `https://api.openai.com`)

### How it works

1. PR opened/updated → Action triggers
2. Fetches PR diff via `gh`
3. Runs 7-step agent loop: gather → analyze → classify → verify → judge → filter
4. Posts line-level review comments on the PR
5. If no bugs: posts LGTM comment

### Models

- Analysis: `gpt-5.4` (deep reasoning)
- Classification: `gpt-5.4-mini` (fast taxonomy)
- Judge: `gpt-5.2` (separate model, avoids self-scoring bias)

## GitNexus Integration (Optional)

GitNexus adds graph-based code context beyond diff/grep: callers, callees, impact radius, and end-to-end process chains. This helps the AI understand semantic relationships and catch bugs in code flows.

### Setup

**Local development:**
```bash
npm install -g gitnexus
cd /path/to/your/repo
gitnexus analyze                    # Index repo (1-5 min on cold run)
gitnexus list                       # Verify: should show symbols
```

**CI:** Cache is automatic via `actions/cache@v4` in the action. Subsequent runs reuse the index (warm run <30s).

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GITNEXUS_ENABLED` | `true` | Enable/disable graph features (gracefully skips if binary missing) |
| `GITNEXUS_BIN` | `gitnexus` | Path to GitNexus CLI binary |
| `GITNEXUS_TIMEOUT_MS` | `30000` | Max time per CLI call; increase for monorepos with large graphs |
| `GITNEXUS_CALLERS_DEPTH` | `1` | How many hops up the call graph to fetch |
| `GITNEXUS_CALLEES_DEPTH` | `1` | How many hops down the call graph to fetch |
| `GITNEXUS_MAX_SYMBOLS_PER_FILE` | `10` | Max symbols per file in impact graph (limits prompt size) |
| `GITNEXUS_TRACER_BUDGET_MS` | `45000` | Total time budget per-file for all symbol tracing (fan-out across context/impact/query) |

### Action Inputs

```yaml
- uses: cyberk-dev/ultrareview-action@v0.1.0
  with:
    ai-api-key: ${{ secrets.AI_API_KEY }}
    gitnexus-enabled: 'true'          # Enable graph context (default)
    gitnexus-secret-scan: 'true'      # Warn if index contains secret patterns
```

### Troubleshooting

| Issue | Fix |
|-------|-----|
| `NOT_INSTALLED` | Run `npm install -g gitnexus` and verify `gitnexus --version` works |
| `NOT_INDEXED` | Run `gitnexus analyze` in repo root to create `.gitnexus/` index |
| `TIMEOUT` | Increase `GITNEXUS_TIMEOUT_MS` env var (default 10s); check if CLI is slow |
| Shallow clone in CI | Ensure `actions/checkout@v4` has `fetch-depth: 0` for full history |
| Cache miss on new branch | First run slow (1-5 min), subsequent runs warm from cache |
| `MULTI_REPO_AMBIGUOUS` | Rare; indicates global gitnexus registry has >1 repo with same path — use `GITNEXUS_ENABLED=false` as workaround |

### Example Output

When enabled, the AI sees an `IMPACT GRAPH` section in the prompt:

```
=== IMPACT GRAPH (GitNexus) ===
File: src/auth/login.ts
Changed symbols: 2

  validatePassword (Function) [lines 45-62]
    Callers (3): handleLogin (src/auth/handlers.ts:20), loginEndpoint (src/api/routes.ts:88)
    Callees (2): bcrypt.compare, logger.debug
    Impact: 7 files, 24 symbols

    Process: "handleLogin → redirectToHome" (5 steps, critical path)
      1. handleLogin (src/auth/handlers.ts:20)
      2. authenticate (src/auth/auth.ts:10)
      3. validatePassword    ← CHANGED
      4. setSession (src/session/manager.ts:55)
      5. redirectToHome (src/auth/handlers.ts:45)

=== 
```

## Intent Injection (Optional)

Intent Injection enriches the deep-analyzer prompt with **what the PR is *supposed* to do**, sourced from spec files in the diff plus PR title/body and linked issues. The block is prepended at the **top** of the prompt so the analyzer frames every file around the PR's declared intent — anti-hallucination for purpose, complementary to GitNexus's anti-hallucination for flow.

### Supported spec formats

| Class | Detection signals | Example paths |
|-------|-------------------|---------------|
| **OpenSpec** | Sibling `proposal.md` + `tasks.md` (+ optional `design.md`, `specs/*.md`) | `openspec/changes/<slug>/*.md` |
| **CK-Plan** | `plans/<slug>/{plan.md, phase-*.md}` (nested) or `plans/<name>.md` (flat) | `plans/<date-slug>/*.md` |
| **Generic** | Whitelisted H2 headings (Overview, Goal, Requirements, …) | `docs/`, `specs/`, `rfc/`, `adr/` |
| **Changelog** | `.changeset/*.md` entries or `CHANGELOG.md` first version section | auto |

### Setup

Mostly zero-config. Enabled by default; spec files in the diff are auto-classified and injected.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `INTENT_ENABLED` | `true` | Master switch — set to `false` to disable Intent injection entirely |
| `INTENT_SCAN_PATHS` | `plans/**/*.md,openspec/**/*.md,docs/**/*.md,specs/**/*.md,rfc/**/*.md,adr/**/*.md,.changeset/*.md,CHANGELOG.md` | Comma-separated globs of paths to scan |
| `INTENT_BUDGET_CHARS` | `4000` | Hard cap for the entire INTENT section (shared across files) |
| `INTENT_PR_META` | `true` | Fetch PR title + body via `gh api` and resolve linked issues |
| `INTENT_LINKED_ISSUES` | `true` | Resolve `#NNN` refs in PR body (capped at 5 issues) |
| `INTENT_CLASSIFIER` | `auto` | Override classifier — `auto`, `openspec`, `plan`, `generic`, `disabled` |
| `INTENT_CLASSIFIER_MIN_CONFIDENCE` | `0.6` | Below this, files downgrade to `unknown` |
| `INTENT_GENERIC_HEADINGS` | (12 defaults) | Comma-separated H2 whitelist for the Generic extractor (e.g. `"Mục đích,Yêu cầu"`) |

### Action input

```yaml
- uses: cyberk-dev/ultrareview-action@v0.3.0
  with:
    ai-api-key: ${{ secrets.AI_API_KEY }}
    intent-enabled: 'true'            # default
```

### Example output

When intent is detected, the analyzer prompt opens with:

```
=== PR INTENT ===
Title: Fix auth token validation
Author: @tunb
Labels: bug, security

Body:
Addresses null-byte injection in validator.
Fixes #123.

Linked issue #123: "Token bypass vulnerability"
  Repro: token containing \0 bypasses regex check.

Detected spec artifacts (2):
  openspec/changes/auth-fix/proposal.md (openspec)
  plans/260420-auth-fix/plan.md (ck-plan)

=== OpenSpec: auth-fix ===
WHY:
  Security: null-byte injection allows auth bypass.

HOW:
  Validator rejects tokens with control chars + length > 4KB.

TODO:
  2/4 done
  - [x] null-byte reject
  - [ ] request_id log

=== Plan: 260420-auth-fix ===
OVERVIEW: Title: Auth Fix · Status: in_progress
PHASES: Phase 01 (completed), Phase 02 (in_progress)

===
SPEC shows declared intent (from spec files).
IMPACT GRAPH shows live code (from AST analysis).
If they disagree, flag as POTENTIAL DRIFT — do NOT auto-trust either.
===
```

### Troubleshooting

| Issue | Fix |
|-------|-----|
| No INTENT section in prompt | Check `INTENT_ENABLED=true`, paths match `INTENT_SCAN_PATHS`, spec files present in diff |
| Wrong classifier picked for my spec | Override with `INTENT_CLASSIFIER=generic` (or `openspec` / `plan`) |
| `gh api` unauthorized | Set `GITHUB_TOKEN` env or run `gh auth login` |
| Budget overflow / prompt p95 too high | Lower `INTENT_BUDGET_CHARS` or trim paths in `INTENT_SCAN_PATHS` |
| Prompt-injection from spec content | Backticks/fences are escaped automatically; please report bypasses |

### Graph bridge (since v0.4.0)

When GitNexus is also enabled, INTENT can surface spec/doc files **not in the diff** by issuing a single keyword query against the indexed `.md` corpus (Section + File nodes). Example: a PR titled "Phase 06 MediaPipe Face Landmarker" that only touches code files may auto-include `plans/260420-1516-post-capture-contour-crop/plan.md` because the keywords overlap with that plan's filename and headings.

The bridge merges with diff-detected specs and is deduped — diff-detected always wins on path collision (higher confidence). Graph-derived entries carry `via GitNexus query: "..."` in their hint and confidence `0.5`, so they drop first under truncation pressure.

| Variable | Default | Purpose |
|----------|---------|---------|
| `INTENT_GRAPH_BRIDGE` | `true` | Enable/disable graph-derived spec retrieval |
| `INTENT_GRAPH_MAX_SPECS` | `2` | Cap related specs per review |
| `INTENT_GRAPH_EXCLUDED` | `README.md,LICENSE,CONTRIBUTING.md` | Comma-separated noise filter |

**Hit-rate caveat:** the bridge only fires when (a) a related plan/doc actually exists and (b) the PR title or changed file/symbol names overlap with its vocabulary. Chore-style fixes with no associated plan see no value-add (graceful skip). Real-world hit rate observed during Phase 0 smoke test: ~33% on 3 PRs. Tune `INTENT_GRAPH_MAX_SPECS` upward only after measuring noise on your corpus.

### Flow diagram (since v0.3.1)

When enabled, ultrareview asks a cheap LLM to draw a Mermaid `flowchart TD` summarizing the code paths it analyzed. The diagram appears at the **top** of the PR review summary in a collapsed `<details>` block — reviewer + author can verify the bot's interpretation in one glance, before reading the bug list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `INTENT_FLOW_DIAGRAM` | `true` | Opt-out switch |
| `AI_FLOW_MODEL` | `gpt-5.4-mini` | Cheap model for diagram synthesis (swap to `kimi-k2.5` / `glm-5` / `qwen3.5-plus` to experiment) |
| `INTENT_FLOW_MAX_NODES` | `10` | Cap diagram complexity for readability |

**Cost & latency** (per PR, default model on cyberk proxy):
- Cost: ~$0.0001 / PR
- Added latency: ~7-10s (one extra LLM call per review)

**Caveat:** the diagram is the bot's *interpretation*, not ground truth. Always verify against actual code before trusting bug analysis. The collapsed `<details>` block includes this caveat inline.

**Smoke-test note** (April 2026): on `ai-proxy.cyberk.io`, `kimi-k2.5` showed ~15× prompt-token overhead from cliproxy-injected context, making it 7-8× more expensive AND ~1.7× slower than `gpt-5.4-mini` for this task. Default chosen accordingly. If your proxy doesn't have this overhead, swap freely.

## Requirements

- Bun >= 1.0
- Git (for diff operations)
- GitHub CLI (`gh`) — used for PR review commands and (since v0.3.0) for fetching PR title/body during Intent injection
- GitNexus CLI (optional, for enhanced graph-based context)

## Versioning

Ultrareview follows [Semantic Versioning](https://semver.org/). Pin your workflow to a tagged release:

```yaml
- uses: cyberk-dev/ultrareview-action@v0.1.0   # recommended — pinned, reproducible
# or: @main                                    # rolling, breakage possible
# or: @<full-commit-sha>                       # maximally pinned, no auto-upgrade
```

- **v0.x.y** — pre-1.0. Minor bumps may include breaking changes; `CHANGELOG.md` flags them.
- **v1.0.0 onward** — stable SemVer contract. Breaking changes only in major bumps.

### Changelog

All notable changes live in [`CHANGELOG.md`](./CHANGELOG.md). Each entry is authored per PR via [changesets](https://github.com/changesets/changesets) (`bun run changeset`) and auto-compiled at release time.

### Contributor workflow

1. Make your changes on a feature branch.
2. Run `bun run changeset` — pick bump type (patch / minor / major), write a one-line summary.
3. Commit `.changeset/<slug>.md` alongside your code.
4. Open PR. On merge, a "Version Packages" PR is auto-opened.
5. Maintainer merges the Version PR → release is tagged + published automatically.

### Maintainer release flow

cyberk-dev org blocks Actions from creating PRs, so the Version PR is opened locally:

```bash
./scripts/prepare-release.sh           # consolidate changesets, branch, push, open PR
# Review + merge the Version PR
# Workflow on merge tags v<X.Y.Z> and creates the GH release
gh release view v<X.Y.Z>               # verify
```

Use `--dry-run` to preview without committing or pushing.

See [`.changeset/README.md`](./.changeset/README.md) for the tool details.
