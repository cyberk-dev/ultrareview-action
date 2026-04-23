---
title: "Brainstorm — INTENT × GitNexus Graph Bridge (Path D POC)"
date: 2026-04-23
session: 11:22 ICT
context: ultrareview-clone v0.3.0 just shipped INTENT injection (spec files in diff). User asked about deepwiki-open RAG. Reframed: NOT install deepwiki — STUDY its RAG technique, then apply to extend INTENT.
---

# Brainstorm — INTENT × GitNexus Graph Bridge

## Problem Statement

INTENT injection (just shipped in v0.3.0) detects spec files **only when they appear in the PR diff**. Real PRs often touch only code files (e.g., `auth.ts`) yet have highly relevant spec/doc files (e.g., `docs/auth-architecture.md`) that the analyzer would benefit from. Currently those go unseen.

Question on the table: **add RAG?** User suggested studying `AsyncFuncAI/deepwiki-open` for inspiration.

## Findings — deepwiki-open RAG

| Layer | Implementation | Smart? |
|---|---|---|
| Chunking | word-based, size=350, overlap=100 | ❌ NOT AST-aware |
| Embedding | text-embedding-3-small / nomic-embed / gemini-embedding | ✓ Standard |
| Vector store | FAISS in-memory | ✓ |
| Retrieval | top_k=20, no rerank, no hybrid BM25 | ❌ Naive |
| Wiki gen | LLM outline from file-tree + README → XML | ❌ Not clustering |
| Deep Research | Planner-executor loop, max 5 iter | ✓ Pattern worth noting |

**Insight**: deepwiki solves "build wiki + chat over repo". ultrareview solves "review one PR". Different use case → cannot copy 1-1.

## Approaches Evaluated

| Path | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | Pure TS RAG inside ultrareview (chunk H2 + embed + cosine) | KISS, in-process, reuse `parseH2Sections` | ~150 LOC new infra (cache, similarity, embedder client) | Defer |
| B | deepwiki-open Docker sidecar | Full pipeline ready | Wrong API surface (wiki/chat ≠ "top-K for diff"); ops burden | Reject |
| C | Path A + multi-iter Deep Research loop | Better retrieval quality | 3-5x latency, breaks review SLA | Reject |
| **D** | **GitNexus query bridge (no embeddings)** | **Zero infra, reuses indexed graph + extractors** | Limited to graph-known specs (won't surface docs disconnected from code symbols) | **Adopt for POC** |

## Recommended Solution — Path D

### Core idea
ultrareview already has GitNexus (559K symbols indexed) + INTENT extractors (just shipped). Bridge them: for each changed code symbol, query GitNexus for related processes → harvest spec/doc files involved → run them through existing extractor pipeline → merge into INTENT block.

### Architecture

```
PR diff
  ↓
GitNexus tracer (existing) → changed symbols + processes
  ↓
[NEW] for each process → participant files
  ↓
[NEW] filter to .md matching INTENT_SCAN_PATHS, dedupe vs Phase-2 diff scan
  ↓
[reuse] classifyFile() (Phase 2) + extractByClass() (Phase 3)
  ↓
[reuse] formatIntentSection() merges into existing block
```

### File changes (POC + production if gate passes)

**New:**
- `src/agent/intent-from-graph.ts` (~80 LOC)
- `src/__tests__/intent-from-graph.test.ts`
- `.changeset/intent-graph-bridge.md` (minor → v0.4.0)

**Modify:**
- `src/agent/intent-collector.ts` — add `collectFromGraph()` parallel to `scanSpecFiles()`, merge entries

**Untouched (anti-scope-creep):**
- ❌ No vector embeddings
- ❌ No reranking
- ❌ No Deep Research loop
- ❌ No wiki gen / chunking

## Smoke Test Protocol (BEFORE writing production code)

1. `gitnexus_list_repos` → confirm `ultrareview-clone` is reachable from `skin-agent-workspace` index (or sub-indexed).
2. Pick 3 historical PRs:
   - **PR1**: code-only diff
   - **PR2**: code + spec mix
   - **PR3**: spec-only
3. For each: run `gitnexus_query` manually with keyword from changed symbols → inspect whether returned processes/files include `.md` specs not in the diff.
4. **Decision Gate**:
   - ≥1/3 surfaces useful spec → IMPLEMENT
   - 0/3 → KILL POC, ship v0.3.0 as-is, move to Plan B (benchmark)

## Success Criteria (production version)

- [ ] INTENT block grows ≤500 chars on average
- [ ] Latency adds ≤2s p95 (one parallel graph query per file)
- [ ] Zero regression in 205 existing tests
- [ ] Manual review of 5 PRs: ≥3 contain a useful related-spec entry not present in the diff

## Risks + Mitigations

| Risk | Mitigation |
|---|---|
| Query returns too many specs → block bloat | Hard cap: top-3 specs per PR, total ≤3 entries appended |
| `ultrareview-clone` not separately indexed | `gitnexus_list_repos` check first; index if missing |
| Generic noise (README, LICENSE) | Excluded-list filter |
| Process query timeout | Reuse `GITNEXUS_TIMEOUT_MS=30s`, graceful skip on fail |
| Cross-process duplication | Dedupe spec paths before extractor call |

## Anti-Scope-Creep Guardrails

- POC scope is **graph→spec bridge only**
- Embeddings, reranking, multi-turn — all go to **separate brainstorm** if Path D underperforms
- If decision gate fails: **DO NOT pivot to Path A in same session**; ship v0.3.0 first

## Next Steps

1. Run smoke test (manual gitnexus_query on 3 PRs) — 30 min
2. If gate passes → invoke `/ck:plan` for phased impl
3. If gate fails → write decision report, close POC, return to v0.3.0 ship checklist

## Unresolved Questions

- Does GitNexus's process-tracing currently include `.md` files as participants? (deepwiki suggests yes — file paths in process steps; need verify in TS wrappers)
- Confidence scoring: how to merge graph-derived spec entries (low confidence) with diff-detected (high confidence) without confusing the formatter's truncation precedence
- Cache key strategy: per-PR (base..head) sufficient? Or per-(base..head, query)?
