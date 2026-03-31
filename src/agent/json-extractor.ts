// ---------------------------------------------------------------------------
// json-extractor.ts — Robustly extract a JSON array from AI response text.
// Tries multiple strategies so malformed/wrapped responses still parse.
// ---------------------------------------------------------------------------

/**
 * Try multiple strategies to extract a JSON array from an AI response.
 * Returns an empty array if all strategies fail.
 */
export function extractJsonArray<T>(response: string): T[] {
  const trimmed = response.trim()

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed as T[]
  } catch {
    // fall through
  }

  // Strategy 2: extract from markdown code fence ```json ... ``` or ``` ... ```
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/
  const fenceMatch = trimmed.match(fenceRe)
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim())
      if (Array.isArray(parsed)) return parsed as T[]
    } catch {
      // fall through
    }
  }

  // Strategy 3: find first `[` ... last `]` and parse
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed as T[]
    } catch {
      // fall through
    }
  }

  return []
}
