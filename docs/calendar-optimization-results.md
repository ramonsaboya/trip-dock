# Calendar optimization results

Implemented on 10 September 2026, following `calendar-performance-research.md`.

## Changes

- Activity and transport assignments are indexed once per itinerary revision. Hour cells use map lookups rather than scanning every record and converting timestamps repeatedly.
- Destination transitions are prepared once and shared across each day's half-hour samples. Destination bands and formatted date labels are memoized.
- Hover selection and drop previews use cell-specific subscriptions. Updating one target no longer rerenders the entire calendar. Exiting, scrolling, or beginning a pan clears selection; the existing 250 ms dwell remains.
- Panning does not update React state on every pointer movement. Scroll geometry is measured and applied at most once per animation frame.
- Trips longer than 14 days render only nearby body columns plus two days of overscan. Full headers and spacer columns preserve the existing merged destination/stay geometry. The focused or dragged day stays mounted. A small fixed-width window helper implements this without adding a dependency; the existing table does not need a general-purpose measurement cache.
- Static paper is a memoized component. Activity resizing no longer invalidates destination paper. Transport resizing still updates its background geometry with half-hour precision.
- Resize previews are coalesced to animation frames. Pending frames are cancelled on release/cancellation/unmount; returning to the original size and losing capture clear temporary state.

The implementation retains React/DOM, the existing table layout, native card dragging, hourly rows, 30-minute snapping, timezone behavior, and revision-checked mutations. This pass does not replace the table with a separate event canvas or introduce a new drag library.

## Data-preparation benchmark

`scripts/benchmark-calendar.mjs` compares the original calendar helpers at `eb10981` with the indexed preparation. Each fixture includes activities and transport between destinations. The legacy path reproduces the repeated cell-level event scans and paper queries; the optimized path prepares indexes and shared day models before equivalent queries. Output checksums matched in all three cases.

Single-pass Node timings on this machine, including first-use costs:

| Trip days | Activities | Original preparation | Optimized preparation |
| ---: | ---: | ---: | ---: |
| 7 | 40 | 581.13 ms | 3.91 ms |
| 30 | 300 | 16,391.82 ms | 25.97 ms |
| 90 | 1,500 | 229,451.32 ms | 121.63 ms |

These are computation timings, not page-load times, drag frame times, or an end-to-end speedup claim. The original component memoized paper between some interactions, so these numbers must not be interpreted as the cost of every prior hover. Fixtures, hardware, JIT behavior, and concurrent work affect results.

Reproduce from the repository root:

```powershell
node --experimental-strip-types scripts/benchmark-calendar.mjs
```

Add `--stress` for the 90-day case, whose original implementation takes several minutes. An optional commit argument selects another baseline with the same helper API.

## Browser verification

- Opened the existing itinerary and verified header alignment, hourly rows, card/header layering, direct cell selection, and selection clearing on pointer exit.
- Used a temporary, separate 90-day/1,500-activity fixture without changing persisted trip data. Removed the fixture after verification.
- The fixture mounted seven days initially and nine after a large horizontal scroll. All mounted body columns matched their date-header left edges with zero measured pixel difference.
- A cell-selection update in the development React Profiler measured approximately 0.3 ms. A large horizontal jump that mounted a new range measured approximately 72.6 ms. These are isolated development observations, not production frame-rate guarantees.

## Automated verification

- 77 web tests passed, including new cases for selective notifications, precise multi-row drop previews, cleanup, window bounds/pinning, local-time indexing, and prepared transition boundaries.
- Web lint and TypeScript checks passed.
- Production Sites/Vinext build passed.

## Remaining performance limits

Large jumps still mount new content; dense overlapping cards, full-width headers, and transport resize rendering can require further work at extreme scales. The current optimization does not add vertical event culling, fully isolate every resize to one React subtree, consolidate all gestures under Pointer Events, or replace table-cell card positioning. Those larger architectural changes should be judged against production traces after this improvement, rather than bundled into an unmeasured rewrite. No blanket 60 fps claim is made.
