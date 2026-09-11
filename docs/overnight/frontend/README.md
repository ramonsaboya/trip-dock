# TripDock frontend review

The frontend now has explicit feature and data boundaries. The application shell is 70 lines, down from 1,910, and each production React component has its own file. Trip creation, entity editing, calendar controls and packing views can be maintained independently. The refactor preserves the current visual design and GraphQL contracts.

Read these documents in order, or go directly to the verification and integration report:

1. [Baseline and contributor file map](01-baseline-map.md): measured structure, state ownership, flows, strengths and remaining coupling.
2. [Research and applicability](02-research.md): official sources, version caveats and product-specific conclusions.
3. [Target and decisions](03-target-and-decisions.md): implemented defaults, alternatives, rollback and prioritized follow-up.
4. [Implementation and verification](04-implementation-and-verification.md): exact checks, screenshot comparisons, limitations and integration instructions.

The baseline is `f80de19f32b39b2b77b940a480fabf4d6cebcd62`. Measurements were collected on 11 September 2026. [Baseline metrics](baseline-metrics.json) and [current metrics](current-metrics.json) are reproducible with `node apps/web/scripts/architecture-metrics.mjs [git-ref]`. Short working rules live in [root AGENTS.md](../../../AGENTS.md) and [web AGENTS.md](../../../apps/web/AGENTS.md).

No application model settings, database schema, CSS, brand assets or hosting configuration changed. The untracked MVP review in the original checkout was read as historical context and preserved.

## Destination-first creation (11 September 2026)

`TripFields` now collects destination cities and required date ranges, with an unused next-city field. `CreateTripForm` derives overall dates through `withDestinationDates` in `lib/trips/stops.ts`, and both manual and AI flows lead to the editable review summary before saving. Trip naming lives in the summary; an empty name uses the route-based default. Server creation rejects any destination missing arrival or departure dates. Existing-trip editing and database schema are unchanged.

Verification: Node 22.23.2 and pnpm 11.19.0; pnpm check passed (109 web tests, 85 API tests, one optional PostgreSQL test skipped), including lint, typechecks and both builds. All nine isolated Chrome flows passed, including manual/AI review, destination date requirements, removal, default naming, stage focus, and desktop/narrow layouts in both themes. Screenshots were visually inspected. No live AI or real-database test was run.
