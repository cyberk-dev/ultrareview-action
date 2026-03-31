// ---------------------------------------------------------------------------
// run-eval.ts — CLI entry point for the prompt optimization eval loop.
//
// Usage:
//   bun run src/eval/run-eval.ts                          # run with default prompt
//   bun run src/eval/run-eval.ts --variant v2-structured  # run specific variant
//   bun run src/eval/run-eval.ts --dry-run                # load dataset, no AI calls
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEval } from './eval-runner.ts'

// ---------------------------------------------------------------------------
// CLI arg parsing (no deps needed — simple)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { variant: string; dryRun: boolean; datasetPath: string } {
  let variant = 'v1-baseline'
  let dryRun = false
  let datasetPath = 'benchmark/golden-review-dataset.json'

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--variant' && argv[i + 1]) { variant = argv[++i]!; }
    else if (arg === '--dataset' && argv[i + 1]) { datasetPath = argv[++i]!; }
  }

  return { variant, dryRun, datasetPath }
}

// ---------------------------------------------------------------------------
// Apply prompt variant to environment (deep-analyzer reads ANALYZER_SYSTEM_PROMPT
// at import time, so we inject it into global scope via a module-level hook)
// ---------------------------------------------------------------------------

async function loadVariant(variant: string): Promise<void> {
  const variantMap: Record<string, string> = {
    'v1-baseline': './prompt-variants/v1-baseline.ts',
    'v2-structured': './prompt-variants/v2-structured.ts',
    'v3-chain-of-thought': './prompt-variants/v3-chain-of-thought.ts',
  }

  const path = variantMap[variant]
  if (!path) {
    console.error(`Unknown variant "${variant}". Available: ${Object.keys(variantMap).join(', ')}`)
    process.exit(1)
  }

  const mod = await import(path) as { prompt: string; name: string }
  // Inject into process.env so deep-analyzer can pick it up if needed
  process.env.EVAL_PROMPT_VARIANT = mod.name
  process.env.EVAL_PROMPT_OVERRIDE = mod.prompt
  console.log(`[eval] Using prompt variant: ${mod.name}`)
}

// ---------------------------------------------------------------------------
// Save results
// ---------------------------------------------------------------------------

function saveResults(variant: string, summary: unknown): void {
  mkdirSync('results', { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = join('results', `eval-${variant}-${timestamp}.json`)
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(`[eval] Results saved to ${outPath}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
console.log(`[eval] Starting eval — variant=${args.variant} dryRun=${args.dryRun}`)

await loadVariant(args.variant)
const summary = await runEval(args.datasetPath, { dryRun: args.dryRun })
saveResults(args.variant, summary)
