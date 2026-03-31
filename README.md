# Ultrareview Clone

Clone of Claude Code's /ultrareview command — Bun + Ink + TypeScript interactive CLI.

## Quick Start (Any Repo)

Add to your repo's `.github/workflows/ultrareview.yml`:

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
      - uses: cyberk-dev/ultrareview-action@v1
        with:
          ai-api-key: ${{ secrets.AI_API_KEY }}
```

Then add `AI_API_KEY` secret in your repo Settings → Secrets.

See [`examples/ultrareview-workflow.yml`](./examples/ultrareview-workflow.yml) for the full example with optional overrides.

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

## Requirements

- Bun >= 1.0
- Git (for diff operations)
- GitHub CLI (`gh`) for PR review commands
