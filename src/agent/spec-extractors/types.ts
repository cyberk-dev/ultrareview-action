// ---------------------------------------------------------------------------
// types.ts — Shared types for spec extractors.
// ---------------------------------------------------------------------------

import type { SpecClass } from '../spec-classifier.ts'

export type ExtractedSpec = {
  class: SpecClass
  sourcePath: string
  sections: Array<{ heading: string; body: string }>
  meta?: Record<string, string>
}
