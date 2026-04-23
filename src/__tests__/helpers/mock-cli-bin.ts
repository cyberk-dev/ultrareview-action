// Generalized mock CLI binary helper. Reusable for `gh`, `gitnexus`, etc.
// Spawns a tiny shell script in a temp dir; first arg selects fixture file.

import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export type MockCliOptions = {
  /** CLI binary name to expose, e.g. 'gh' or 'gitnexus'. */
  toolName: string
  /** Map: command-key → JSON or text payload to print on stdout. */
  fixtures: Record<string, string>
  /** Optional default exit code when no fixture matches (default: 1). */
  defaultExit?: number
}

export type MockCliHandle = {
  binPath: string
  binDir: string
  tempDir: string
  cleanup: () => void
}

/**
 * Setup a mock CLI binary. To activate, prepend `binDir` to PATH:
 *   process.env.PATH = `${handle.binDir}:${process.env.PATH}`
 */
export function setupMockCliBin(options: MockCliOptions): MockCliHandle {
  const { toolName, fixtures, defaultExit = 1 } = options
  const tempDir = mkdtempSync(join(tmpdir(), `mock-${toolName}-`))
  const binDir = join(tempDir, 'bin')
  const fixturesDir = join(tempDir, 'fixtures')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(fixturesDir, { recursive: true })

  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(fixturesDir, `${name}.out`), data)
  }

  const binPath = join(binDir, toolName)
  // Script joins all args with `_` and slugifies to match a fixture filename.
  const script = `#!/bin/bash
args="$*"
key=$(echo "$args" | tr ' /' '__' | tr -cd 'a-zA-Z0-9_.-')
fixturesdir="${fixturesDir}"
if [ -f "$fixturesdir/$key.out" ]; then
  cat "$fixturesdir/$key.out"
  exit 0
fi
# Fallback: try first arg only
first=$(echo "$1" | tr -cd 'a-zA-Z0-9_.-')
if [ -f "$fixturesdir/$first.out" ]; then
  cat "$fixturesdir/$first.out"
  exit 0
fi
exit ${defaultExit}
`
  writeFileSync(binPath, script)
  chmodSync(binPath, 0o755)

  return {
    binPath,
    binDir,
    tempDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  }
}
