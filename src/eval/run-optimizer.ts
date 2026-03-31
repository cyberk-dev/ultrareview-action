// ---------------------------------------------------------------------------
// run-optimizer.ts — CLI entry point for the auto-prompt optimization loop.
// Usage: bun run src/eval/run-optimizer.ts [--max-iterations N]
//        [--target-precision X] [--target-recall X] [--dry-run]
// ---------------------------------------------------------------------------

import { runOptimization, type OptimizationConfig } from './auto-optimizer.ts'

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { config: Partial<OptimizationConfig>; dryRun: boolean } {
  const config: Partial<OptimizationConfig> = {}
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = argv[i + 1]

    switch (arg) {
      case '--max-iterations':
        if (next !== undefined) { config.maxIterations = parseInt(next, 10); i++ }
        break
      case '--target-precision':
        if (next !== undefined) { config.targetPrecision = parseFloat(next); i++ }
        break
      case '--target-recall':
        if (next !== undefined) { config.targetRecall = parseFloat(next); i++ }
        break
      case '--stale-iterations':
        if (next !== undefined) { config.staleIterations = parseInt(next, 10); i++ }
        break
      case '--dataset':
        if (next !== undefined) { config.datasetPath = next; i++ }
        break
      case '--dry-run':
        dryRun = true
        break
    }
  }

  return { config, dryRun }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const { config, dryRun } = parseArgs(args)

if (dryRun) {
  const defaults = {
    maxIterations: 10,
    targetPrecision: 0.8,
    targetRecall: 0.7,
    staleIterations: 3,
  }
  const effective = { ...defaults, ...config }
  console.log('\n[dry-run] Optimization config:')
  console.log(`  maxIterations:    ${effective.maxIterations}`)
  console.log(`  targetPrecision:  ${effective.targetPrecision}`)
  console.log(`  targetRecall:     ${effective.targetRecall}`)
  console.log(`  staleIterations:  ${effective.staleIterations}`)
  if (config.datasetPath) console.log(`  datasetPath:      ${config.datasetPath}`)
  console.log('\n[dry-run] No eval runs performed.')
  process.exit(0)
}

const result = await runOptimization(config)

console.log('\n=== OPTIMIZATION COMPLETE ===')
console.log(`Best iteration:  ${result.bestIteration}`)
console.log(`Best precision:  ${(result.bestMetrics.precision * 100).toFixed(1)}%`)
console.log(`Best recall:     ${(result.bestMetrics.recall * 100).toFixed(1)}%`)
console.log(`Best F1:         ${(result.bestMetrics.f1 * 100).toFixed(1)}%`)
console.log('Best prompt saved to: results/best-prompt.txt')
