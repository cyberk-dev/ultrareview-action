#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Ultrareview Action — one-command setup for any GitHub repo
# Usage: curl -fsSL https://raw.githubusercontent.com/cyberk-dev/ultrareview-action/main/scripts/init.sh | bash
#   or:  bash <(curl -fsSL .../scripts/init.sh)
#   or:  ./scripts/init.sh (from cloned repo)
# ---------------------------------------------------------------------------
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC} $1"; }
ok()    { echo -e "${GREEN}[ok]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
fail()  { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || fail "git not found. Install git first."
command -v gh  >/dev/null 2>&1 || fail "GitHub CLI (gh) not found. Install: brew install gh"

git rev-parse --git-dir >/dev/null 2>&1 || fail "Not in a git repo. cd into your project first."

# Detect repo owner/name
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REMOTE_URL" ]]; then
  fail "No git remote 'origin'. Push your repo to GitHub first."
fi

# Parse owner/repo from URL
if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
else
  fail "Could not parse GitHub owner/repo from: $REMOTE_URL"
fi

info "Detected repo: ${OWNER}/${REPO}"

# ---------------------------------------------------------------------------
# Get latest pinned SHA from ultrareview-action
# ---------------------------------------------------------------------------
info "Fetching latest ultrareview-action release tag..."
ACTION_TAG=$(gh api repos/cyberk-dev/ultrareview-action/releases/latest --jq '.tag_name' 2>/dev/null || echo "")
if [[ -n "$ACTION_TAG" ]]; then
  ACTION_REF="${ACTION_TAG}"
  ok "Pinned to release: ${ACTION_TAG}"
else
  warn "No tagged release found. Falling back to latest commit SHA..."
  ACTION_SHA=$(gh api repos/cyberk-dev/ultrareview-action/commits/main --jq '.sha' 2>/dev/null || echo "")
  if [[ -z "$ACTION_SHA" ]]; then
    warn "Could not fetch SHA either. Using 'main' (least secure)."
    ACTION_REF="main"
  else
    ACTION_REF="${ACTION_SHA}"
    ok "Pinned to SHA: ${ACTION_SHA:0:12}..."
  fi
fi

# ---------------------------------------------------------------------------
# Create workflow file
# ---------------------------------------------------------------------------
WORKFLOW_DIR=".github/workflows"
WORKFLOW_FILE="${WORKFLOW_DIR}/ultrareview.yml"

if [[ -f "$WORKFLOW_FILE" ]]; then
  warn "Workflow already exists at ${WORKFLOW_FILE}. Overwrite? (y/N)"
  read -r REPLY
  [[ "$REPLY" =~ ^[Yy]$ ]] || { info "Skipped. Keeping existing workflow."; exit 0; }
fi

mkdir -p "$WORKFLOW_DIR"

cat > "$WORKFLOW_FILE" << YAML
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
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git diff base..head

      # GitNexus cache — saves 1-5 min on warm runs by reusing the prior index.
      # Cache key uses PR HEAD sha (stable per push within the same PR).
      # Restore-keys ladder: exact -> same base branch -> same repo (broad fallback).
      - name: Cache GitNexus index
        uses: actions/cache@v4
        with:
          path: .gitnexus
          key: gitnexus-v1-\${{ github.repository }}-\${{ github.event.pull_request.head.sha || github.sha }}
          restore-keys: |
            gitnexus-v1-\${{ github.repository }}-\${{ github.base_ref }}-
            gitnexus-v1-\${{ github.repository }}-

      # Incremental index: reuses cached .gitnexus/ on warm runs (<30s).
      # Cold run performs full indexing (~1-5 min). Failure is non-fatal.
      - name: Index GitNexus (incremental)
        continue-on-error: true
        run: |
          npx gitnexus analyze --incremental || {
            echo "::warning::GitNexus index failed — ultrareview will run without graph context"
            exit 0
          }
          echo "::notice::GitNexus index size: \$(du -sh .gitnexus 2>/dev/null | cut -f1)"

      # Warn if indexed files contain secret-like patterns. Never blocks PR.
      - name: Scan GitNexus index for leaked secrets
        continue-on-error: true
        run: |
          if [ -d .gitnexus ]; then
            HITS=\$(grep -rl "API_KEY\|SECRET\|TOKEN\|PRIVATE_KEY" .gitnexus/ 2>/dev/null | head -5 || true)
            if [ -n "\$HITS" ]; then
              echo "::warning::GitNexus index may contain secret-like patterns. Review these files:"
              echo "\$HITS" | while read -r f; do echo "::warning file=\$f::Potential secret pattern found"; done
            fi
          fi

      - uses: cyberk-dev/ultrareview-action@${ACTION_REF}
        with:
          ai-api-key: \${{ secrets.AI_API_KEY }}
          ai-base-url: \${{ secrets.AI_BASE_URL }}
        env:
          GITNEXUS_ENABLED: "true"
YAML

ok "Created ${WORKFLOW_FILE}"

# ---------------------------------------------------------------------------
# Check secrets
# ---------------------------------------------------------------------------
info "Checking repository secrets..."

HAS_API_KEY=$(gh secret list --repo "${OWNER}/${REPO}" 2>/dev/null | grep -c "AI_API_KEY" || true)
HAS_BASE_URL=$(gh secret list --repo "${OWNER}/${REPO}" 2>/dev/null | grep -c "AI_BASE_URL" || true)

if [[ "$HAS_API_KEY" -eq 0 ]]; then
  warn "AI_API_KEY secret not set."
  echo -e "  Set it with: ${YELLOW}gh secret set AI_API_KEY --repo ${OWNER}/${REPO}${NC}"
  echo -e "  Or go to: https://github.com/${OWNER}/${REPO}/settings/secrets/actions"
else
  ok "AI_API_KEY secret found"
fi

if [[ "$HAS_BASE_URL" -eq 0 ]]; then
  warn "AI_BASE_URL secret not set (optional, defaults to api.openai.com)."
  echo -e "  Set it with: ${YELLOW}gh secret set AI_BASE_URL --repo ${OWNER}/${REPO}${NC}"
else
  ok "AI_BASE_URL secret found"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Ultrareview setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Next steps:"
echo "  1. Set secrets (if not done):"
echo -e "     ${YELLOW}gh secret set AI_API_KEY --repo ${OWNER}/${REPO}${NC}"
echo -e "     ${YELLOW}gh secret set AI_BASE_URL --repo ${OWNER}/${REPO}${NC}"
echo "  2. Commit and push:"
echo -e "     ${YELLOW}git add ${WORKFLOW_FILE} && git commit -m 'ci: add ultrareview' && git push${NC}"
echo "  3. Open a PR → Ultrareview will auto-review it!"
echo ""
