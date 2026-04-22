import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Fixture JSON data — keyed by fixture name
const fixtures: Record<string, string> = {
  'context-ok': JSON.stringify({
    version: '1.0',
    repo: 'test-repo',
    timestamp: '2024-04-22T00:00:00Z',
  }),
  'context-empty': JSON.stringify({}),
  'detect-changes-ok': JSON.stringify({
    files: [
      {
        path: 'src/main.ts',
        symbols: [
          { name: 'myFunction', type: 'function', line: 10 },
          { name: 'MyClass', type: 'class', line: 20 },
        ],
      },
    ],
  }),
  'impact-ok': JSON.stringify({
    symbols: [
      {
        name: 'myFunction',
        callers: ['caller1', 'caller2'],
        callees: ['callee1'],
      },
    ],
  }),
  'route-map-ok': JSON.stringify({
    routes: [{ pattern: '/api/users', handlers: ['getUserList', 'getUser'] }],
  }),
  'shape-check-ok': JSON.stringify({
    structures: [{ name: 'User', fields: ['id', 'name', 'email'] }],
  }),
  'list-ok': JSON.stringify({
    repos: [{ name: 'test-repo', path: '/tmp/test-repo' }],
  }),
}

/**
 * Setup a mock gitnexus binary in a temp directory.
 * Returns: { binPath: string, tempDir: string, cleanup: () => void }
 * Usage: in beforeEach, set process.env.GITNEXUS_BIN = binPath
 */
export function setupMockGitNexusBin(): {
  binPath: string
  tempDir: string
  cleanup: () => void
} {
  const tempDir = mkdtempSync(join(tmpdir(), 'gitnexus-mock-'))
  const binPath = join(tempDir, 'gitnexus')
  const fixturesDir = join(tempDir, 'fixtures')

  // Create fixtures directory
  mkdirSync(fixturesDir, { recursive: true })

  // Write all default fixtures
  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(fixturesDir, `${name}.json`), data)
  }

  // Create shell script that echoes fixture based on args
  // Special handling for 'list' command to return repo info
  // Use escaped variable references so tempDir/fixturesDir are embedded correctly
  const script = `#!/bin/bash
cmd="\${1:-context}"
tempdir="${tempDir}"
fixturesdir="${fixturesDir}"
if [ "\$cmd" = "list" ]; then
  cat <<EOF
  test-repo
    Path: \$tempdir
EOF
  exit 0
elif [ -f "\$fixturesdir/\$cmd.json" ]; then
  cat "\$fixturesdir/\$cmd.json"
  exit 0
else
  exit 1
fi
`

  writeFileSync(binPath, script)
  chmodSync(binPath, 0o755)

  const cleanup = () => {
    rmSync(tempDir, { recursive: true, force: true })
  }

  return { binPath, tempDir, cleanup }
}

