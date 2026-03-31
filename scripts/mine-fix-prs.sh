#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Mine fix/refactor PRs from a GitHub repo to build golden review dataset.
# Extracts diff + files + commit messages → JSON samples for eval.
#
# Usage:
#   ./scripts/mine-fix-prs.sh cyberk-dev/skin-agent-app [--limit 30]
#   ./scripts/mine-fix-prs.sh cyberk-dev/skin-agent-app --include-fix-commits
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${1:?Usage: $0 owner/repo [--limit N] [--include-fix-commits]}"
LIMIT=30
INCLUDE_FIX_COMMITS=false
OUTPUT_DIR="benchmark/mined-samples"

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --include-fix-commits) INCLUDE_FIX_COMMITS=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC} $1"; }
ok()    { echo -e "${GREEN}[ok]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }

mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Source 1: PRs with fix/refactor/hotfix titles
# ---------------------------------------------------------------------------
info "Mining merged fix/refactor PRs from ${REPO} (limit: ${LIMIT})..."

PR_NUMBERS=$(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
  --search "fix OR refactor OR hotfix OR bugfix in:title" \
  --json number,title,mergedAt \
  --jq '.[] | "\(.number)\t\(.title)\t\(.mergedAt)"' 2>/dev/null || echo "")

if [[ -z "$PR_NUMBERS" ]]; then
  warn "No fix PRs found. Try increasing --limit or check repo access."
  exit 0
fi

PR_COUNT=$(echo "$PR_NUMBERS" | wc -l | tr -d ' ')
info "Found ${PR_COUNT} fix/refactor PRs"

# ---------------------------------------------------------------------------
# Extract each PR → JSON sample
# ---------------------------------------------------------------------------
SAMPLE_INDEX=0
echo "$PR_NUMBERS" | while IFS=$'\t' read -r PR_NUM PR_TITLE MERGED_AT; do
  SAMPLE_INDEX=$((SAMPLE_INDEX + 1))
  SAMPLE_ID="pr-${PR_NUM}"
  SAMPLE_FILE="${OUTPUT_DIR}/${SAMPLE_ID}.json"

  if [[ -f "$SAMPLE_FILE" ]]; then
    warn "Skip ${SAMPLE_ID} (already exists)"
    continue
  fi

  info "[${SAMPLE_INDEX}/${PR_COUNT}] PR #${PR_NUM}: ${PR_TITLE}"

  # Get diff
  DIFF=$(gh pr diff "$PR_NUM" --repo "$REPO" 2>/dev/null || echo "")
  if [[ -z "$DIFF" ]]; then
    warn "  Empty diff, skipping"
    continue
  fi

  DIFF_SIZE=${#DIFF}
  if [[ $DIFF_SIZE -gt 200000 ]]; then
    warn "  Diff too large (${DIFF_SIZE} chars), skipping"
    continue
  fi

  # Get PR body/description
  PR_BODY=$(gh pr view "$PR_NUM" --repo "$REPO" --json body --jq '.body // ""' 2>/dev/null || echo "")

  # Get changed files list
  CHANGED_FILES=$(gh pr diff "$PR_NUM" --repo "$REPO" --name-only 2>/dev/null || echo "")

  # Get commit messages (to identify what bugs were fixed)
  COMMITS=$(gh pr view "$PR_NUM" --repo "$REPO" --json commits \
    --jq '[.commits[] | {sha: .oid[0:8], message: .messageHeadline}]' 2>/dev/null || echo "[]")

  # Build JSON sample (bugs field empty — needs human review)
  cat > "$SAMPLE_FILE" << ENDJSON
{
  "id": "${SAMPLE_ID}",
  "source": "${REPO}#${PR_NUM}",
  "title": $(echo "$PR_TITLE" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))"),
  "merged_at": "${MERGED_AT}",
  "description": $(echo "$PR_BODY" | head -20 | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))"),
  "diff_size": ${DIFF_SIZE},
  "changed_files": $(echo "$CHANGED_FILES" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))"),
  "commits": ${COMMITS},
  "injected_bugs": [],
  "_review_status": "pending",
  "_reviewer_notes": ""
}
ENDJSON

  # Save diff separately (too large for inline JSON)
  echo "$DIFF" > "${OUTPUT_DIR}/${SAMPLE_ID}.diff"

  ok "  Saved ${SAMPLE_FILE} (${DIFF_SIZE} chars diff)"

  # Rate limit: 1 sec between API calls
  sleep 1
done

# ---------------------------------------------------------------------------
# Source 2: Fix commits within feature PRs (optional)
# ---------------------------------------------------------------------------
if [[ "$INCLUDE_FIX_COMMITS" == "true" ]]; then
  info "Mining fix commits within recent feature PRs..."

  FEATURE_PRS=$(gh pr list --repo "$REPO" --state merged --limit 20 \
    --search "feat OR feature OR add in:title" \
    --json number,title --jq '.[].number' 2>/dev/null || echo "")

  for PR_NUM in $FEATURE_PRS; do
    FIX_COMMITS=$(gh pr view "$PR_NUM" --repo "$REPO" --json commits \
      --jq '[.commits[] | select(.messageHeadline | test("^fix|^Fix|^FIX")) | {sha: .oid[0:8], message: .messageHeadline}]' 2>/dev/null || echo "[]")

    FIX_COUNT=$(echo "$FIX_COMMITS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$FIX_COUNT" -gt 0 ]]; then
      info "  PR #${PR_NUM} has ${FIX_COUNT} fix commits — flagged for review"
      echo "${PR_NUM}: ${FIX_COMMITS}" >> "${OUTPUT_DIR}/fix-commits-in-features.txt"
    fi

    sleep 1
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$(find "$OUTPUT_DIR" -name "pr-*.json" | wc -l | tr -d ' ')
PENDING=$(grep -l '"pending"' "$OUTPUT_DIR"/pr-*.json 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Mining complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Samples: ${TOTAL} in ${OUTPUT_DIR}/"
echo "  Pending review: ${PENDING}"
echo ""
echo "  Next steps:"
echo "  1. Review each .json file — add bugs to 'injected_bugs' array"
echo "  2. Read the .diff file to understand what was fixed"
echo "  3. Set '_review_status' to 'reviewed' when done"
echo "  4. Run: bun run src/eval/build-dataset.ts ${OUTPUT_DIR}/"
echo "     to merge reviewed samples into golden-review-dataset.json"
echo ""
