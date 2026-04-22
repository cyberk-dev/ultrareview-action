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

## Requirements

- Bun >= 1.0
- Git (for diff operations)
- GitHub CLI (`gh`) for PR review commands
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

See [`.changeset/README.md`](./.changeset/README.md) for the tool details.
