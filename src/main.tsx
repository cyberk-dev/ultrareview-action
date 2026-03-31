#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { Command } from '@commander-js/extra-typings'
import { App } from './components/app.tsx'
import { Repl } from './repl.tsx'
import { runNonInteractive } from './non-interactive.tsx'

// ---------------------------------------------------------------------------
// Launch the Ink REPL (interactive, needs TTY)
// ---------------------------------------------------------------------------
async function launchRepl(initialInput?: string): Promise<void> {
  const { waitUntilExit } = render(
    <App>
      <Repl initialInput={initialInput} />
    </App>,
  )
  await waitUntilExit()
}

// ---------------------------------------------------------------------------
// CLI entry via Commander.js
// ---------------------------------------------------------------------------
const program = new Command()
  .name('ultrareview-clone')
  .description('Clone of FavAI ultrareview — interactive code review CLI')
  .argument('[input...]', 'Initial slash command or message (e.g. /review 123)')
  .option('-p, --print', 'Non-interactive mode (no TTY required, prints to stdout)')
  .option('-r, --repo <repo>', 'GitHub repo in owner/name format (e.g. cyberk-dev/skin-agent-app)')
  .option('-g, --github', 'Post review comments to GitHub PR (requires --repo and PR number in command)')
  .action(async (input: string[], options: { print?: boolean; repo?: string; github?: boolean }) => {
    const joined = input.join(' ').trim()

    // Store repo in env for git helpers to pick up
    if (options.repo) process.env.GH_REPO = options.repo

    if (options.print && joined) {
      // Non-interactive: run command, print result, exit
      await runNonInteractive(joined, { github: options.github })
    } else {
      await launchRepl(joined || undefined)
    }
  })

program.parse()
