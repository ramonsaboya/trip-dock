# TripDock frontend review

## Trip editing and expanded workbench (6 October 2026)

`TripDetail` owns the trip editor and transient full-width state. `TripEditor` edits the saved name, overall range and every destination's arrival/departure dates through one `updateTrip`, using the revision captured when opened. The optional `UpdateTripInput.stops` carries every existing stop ID and date range exactly once; the API checks membership, ranges and chronology within the same transaction. Optional `newStops` adds cities with required arrival/departure dates in that same transaction, with a combined limit of 20 destinations. Saved destinations cannot be renamed or removed in this editor. `TripCalendar` renders the bracket expansion control alongside zoom. `theme.css` expands only the calendar section and desktop pool, keeping the header in its normal position. The existing calendar ResizeObserver handles its changed viewport without remounting or resetting zoom.

The owner accepted the destination editor and stationary controls iteration on 6 October 2026. The release verification below covers the accepted changes.

The edit dialog uses creation's `stops-editor`, `draft-stop` and `destination-fields` styles. Trip name and overall dates appear above destinations in a three-column row on wider screens. Each destination shows City, Arrival date and Departure date. Saved city names remain read-only; Add destination appends an editable city/date row that can be removed before saving. New rows remain draft-only until Save changes.

Zoom/expansion controls are fixed to the standard page frame at the bottom of the viewport, so expansion does not move the buttons. The wider desktop pool starts at 1300px to keep the stationary controls clear of the pool.

Server date edits remain atomic under the parent trip lock. Linked boundary dates follow trip dates; all destination intervals are clipped to the new range, preserving destinations even when reduced to one day. Scheduled activities whose local time interval falls outside their trip or destination return to the pool by clearing only `scheduledAt`. Midnight end times are exclusive. Stay and transport bookings remain unchanged. Enlarging dates never reschedules pool activities automatically.

Verification: Node 22.23.2 / pnpm 11.19.0; `pnpm check` passed (109 web tests, 85 API tests, one optional PostgreSQL test skipped), including lint, types and builds. All 15 isolated Chrome flows passed, including destination additions/removal before saving, inner date edits, cancellation, error retention, reload and stationary width toggling on desktop/mobile in both themes. `pnpm test:postgres` passed on the dedicated local `tripdock_test`, including shared regressions for date clipping, activity timezone/duration boundaries, booking preservation, atomic destination additions, invalid-edit rollback and stale revision rejection. The earlier release browser review against the real isolated itinerary API confirmed activities return to the pool after shortening a trip and persist after reload. The current preview review confirmed the creation-style destination layout and identical toolbar coordinates before and after expansion; draft changes were cancelled. No billed AI commands were run.

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
