// ---------------------------------------------------------------------------
// /review command — fetch PR details + diff, send to cliproxy AI
// ---------------------------------------------------------------------------
import type { PromptCommand } from './commands.ts'
import { getPrDiff, getPrView } from '../utils/git.ts'

/** System prompt for the AI reviewer */
export const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided pull request thoroughly:
- Identify bugs, security issues, and performance problems
- Suggest improvements for readability and maintainability
- Highlight what is done well
- Be concise and actionable — use bullet points
- Prioritize issues by severity (Critical / Major / Minor)
Format your review with clear sections: Summary, Issues, Suggestions, Praise.`

export const reviewCommand: PromptCommand = {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request  (/review <PR#>)',
  aliases: ['pr'],

  async getPromptForCommand(args: string): Promise<string> {
    const prNumber = args.trim()

    if (!prNumber) {
      // No PR number — list open PRs
      let list: string
      try {
        list = await Bun.$`gh pr list --limit 10`.quiet().text()
        list = list.trim()
      } catch {
        list = 'No PRs found or gh not installed'
      }

      return list
        ? `Open PRs:\n${list}\n\nUse /review <number> to review a specific PR.`
        : 'No open PRs found. Use /review <number> to review a specific PR.'
    }

    // Validate that the arg looks like a PR number
    if (!/^\d+$/.test(prNumber)) {
      return `Invalid PR number: "${prNumber}". Usage: /review <number>`
    }

    const [view, diff] = await Promise.all([
      getPrView(prNumber),
      getPrDiff(prNumber),
    ])

    if (!diff || diff.startsWith('Failed to fetch')) {
      return `Could not fetch PR #${prNumber}.\n${view}\n${diff}`
    }

    return buildReviewPrompt(prNumber, view, diff)
  },
}

// ---------------------------------------------------------------------------
// Build the prompt that will be sent to the AI
// ---------------------------------------------------------------------------
function buildReviewPrompt(prNumber: string, view: string, diff: string): string {
  const MAX_DIFF_CHARS = 40_000
  const truncatedDiff =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[...diff truncated at ${MAX_DIFF_CHARS} chars...]`
      : diff

  return [
    `Please review PR #${prNumber}:`,
    '',
    '## PR Details',
    view,
    '',
    '## Diff',
    '```diff',
    truncatedDiff,
    '```',
  ].join('\n')
}
