// ---------------------------------------------------------------------------
// Real git helpers using Bun shell — all errors return null/empty string
// ---------------------------------------------------------------------------

/** Parsed repo identity + current branch */
export type RepoInfo = { owner: string; name: string; branch: string }

/** Run git remote show origin quietly; return trimmed stdout or null on failure */
async function gitRemoteShow(): Promise<string | null> {
  try {
    const result = await Bun.$`git remote show origin`.quiet().text()
    return result.trim() || null
  } catch {
    return null
  }
}

/** Parse owner/repo from git remote URL (https or ssh) */
function parseRemoteUrl(url: string): { owner: string; name: string } | null {
  // https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/)
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], name: httpsMatch[2] }
  }

  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], name: sshMatch[2] }
  }

  return null
}

export async function detectRepo(): Promise<RepoInfo | null> {
  try {
    const remoteUrl = await Bun.$`git remote get-url origin`.quiet().text()
    const parsed = parseRemoteUrl(remoteUrl.trim())
    if (!parsed) return null

    const branch = await getCurrentBranch()
    return { ...parsed, branch }
  } catch {
    return null
  }
}

export async function getCurrentBranch(): Promise<string> {
  try {
    const result = await Bun.$`git branch --show-current`.quiet().text()
    return result.trim() || 'main'
  } catch {
    return 'main'
  }
}

export async function getDefaultBranch(): Promise<string> {
  try {
    const result = await Bun.$`git symbolic-ref refs/remotes/origin/HEAD`.quiet().text()
    // output: refs/remotes/origin/main
    const parts = result.trim().split('/')
    return parts[parts.length - 1] || 'main'
  } catch {
    // fallback: try to detect via remote info
    const fallback = await gitRemoteShow()
    if (fallback) {
      const match = fallback.match(/HEAD branch: (.+)/)
      if (match?.[1]) return match[1].trim()
    }
    return 'main'
  }
}

export async function getMergeBase(baseBranch: string): Promise<string | null> {
  try {
    const result = await Bun.$`git merge-base ${baseBranch} HEAD`.quiet().text()
    return result.trim() || null
  } catch {
    return null
  }
}

export async function getDiffAgainstBase(): Promise<string> {
  try {
    const base = await getDefaultBranch()
    const mergeBase = await getMergeBase(base)
    if (!mergeBase) return ''

    const result = await Bun.$`git diff ${mergeBase}..HEAD`.quiet().text()
    return result.trim()
  } catch {
    return ''
  }
}

export async function getPrDiff(prNumber: string): Promise<string> {
  // Verify gh CLI is installed first
  try {
    await Bun.$`gh --version`.quiet().text()
  } catch {
    throw new Error('GitHub CLI not found. Install with: brew install gh')
  }

  try {
    const repoFlag = process.env.GH_REPO ? ['--repo', process.env.GH_REPO] : []
    const result = await Bun.$`gh pr diff ${prNumber} ${repoFlag}`.quiet().text()
    return result.trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to fetch PR #${prNumber} diff: ${msg}`)
  }
}

export async function getPrView(prNumber: string): Promise<string> {
  try {
    const repoFlag = process.env.GH_REPO ? ['--repo', process.env.GH_REPO] : []
    const result = await Bun.$`gh pr view ${prNumber} ${repoFlag}`.quiet().text()
    return result.trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Failed to fetch PR details: ${msg}`
  }
}

/** Verify current directory is inside a git repository */
export async function assertGitRepo(): Promise<void> {
  try {
    await Bun.$`git rev-parse --git-dir`.quiet().text()
  } catch {
    throw new Error('Not in a git repository. Run this command inside a git project.')
  }
}
