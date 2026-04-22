---
"ultrareview-clone": patch
---

DEFERRED: route_map and shape_check signals not implemented via CLI.

Reason: `gitnexus` CLI (v current) does not expose `route_map` or `shape_check` subcommands — these are MCP-only tools. Probe confirmed via `gitnexus --help`.

Impact:
- `routeMap()` and `shapeCheck()` wrappers in `gitnexus-typed-wrappers.ts` return `[]` (NOT_SUPPORTED stubs).
- `shouldFetchRouteMap()` and `shouldFetchShapeCheck()` heuristics are implemented and tested.
- `TracedSymbol.routeImpact` and `TracedSymbol.shapeDrift` fields are typed and wired.
- Formatter renders Route/Shape lines when data is present (tested via synthetic symbols).
- Truncation tier-1 policy (drop extras first) is active.
- A `console.warn` fires when either signal is triggered so operators know the feature is pending.

To promote: replace stub bodies in `fetchRouteMapOnce` / `fetchShapeDriftOnce` with real MCP calls once CLI support is added or an MCP proxy path is wired.
