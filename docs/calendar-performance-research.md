# TripDock calendar architecture and performance review

Date: 10 September 2026

Scope: source review of the calendar at commit `eb10981`, plus current primary-source research. This report does not include browser benchmarks or claim a measured speedup. No application behavior was changed.

## Recommendation

Keep React and HTML/CSS for the calendar. Refactor the rendering and interaction architecture before changing rendering technology. Use a shared coordinate model, independently bounded header/event layers, indexed calendar data, and isolated interaction previews. Add horizontal virtualization with TanStack Virtual when the benchmark demonstrates a need for longer trips.

FullCalendar TimeGrid is the strongest packaged alternative considered here. Evaluate a small prototype against the custom header and transport requirements before adopting it. Canvas or Three.js should not be the default direction for this text-heavy planner.

This is a recommendation based on the product requirements and implementation review, not proof that one library is universally fastest. A production-build profile must establish the actual bottlenecks.

## What the current implementation does

The planner uses React 19 and a native HTML table, with custom CSS, native HTML drag-and-drop for moving cards, and Pointer Events for panning and resizing. It has no calendar or virtualization library.

The main implementation is `apps/web/components/trip-calendar.tsx`; geometry and itinerary helpers are in `apps/web/lib/trip-calendar.ts`. The current implementation renders 24 hourly rows for every trip day. Half-hour positioning is represented inside those rows, which is appropriate for the requested visual design.

Source findings:

1. **Repeated event lookup during rendering.** Every day/hour cell filters the full activity list and transport list. These predicates also calculate assignments and local times. The work scales with both the number of rendered cells and the number of records. Indexing records by day/start hour once would remove those repeated scans.
2. **Repeated background calculations.** The `papers` memo calls destination and transition helpers repeatedly for each day/hour. Those helpers reconstruct day transitions, sort stops, filter routes, and calculate local times. The memo avoids repeating this work on ordinary selection changes, but duration/resize changes invalidate it across the trip.
3. **Interaction state has a broad rendering scope.** Selection and drop-preview state live in the main calendar component. Changing that state executes the component and its cell-level filters again. Memoizing the background does not isolate the rest of the calendar.
4. **Cards are positioned inside their starting-hour cells.** They overflow across subsequent table rows. This couples event geometry to table-cell stacking, making sticky headers, time labels, clipping, and borders harder to maintain. This is a plausible architectural contributor to the visual bugs, not a measured performance diagnosis.
5. **All days remain mounted.** Long trips multiply cells, texture elements, labels, and event lookup work even when most days are offscreen.
6. **Multiple interaction mechanisms need coordination.** Native card dragging and pointer-based panning/resizing have separate lifecycles. Their coexistence is not inherently invalid, but it increases the risk of gesture priority, cancellation, and preview inconsistencies.

The existing direct header-highlight updates and background memoization are useful improvements. The remaining lag cannot be attributed to React, table layout, GPU compositing, or a specific CSS property without a trace. The reported Alt-Tab repaint likewise remains unmeasured.

## Technology comparison

| Approach | Fit for this planner | Recommendation |
| --- | --- | --- |
| Custom React + DOM/CSS | Retains custom merged destination/stay headers, textures, accessible controls, and arbitrary event positioning. Requires ownership of scheduling interactions. | Preferred architectural direction. |
| React + TanStack Virtual | Preserves custom markup while limiting mounted day columns. Virtualization is a rendering tool, not a scheduling engine. | Add for demonstrated long-trip costs. |
| FullCalendar TimeGrid | Already provides time-grid event layout and interaction features. Custom merged headers and diagonal destination transitions require validation. | Strong alternative to prototype before committing to a larger custom rewrite. |
| Canvas/Konva | Useful for dense drawing interfaces; text controls, focus, accessibility, and hit testing require additional design. | Consider only if measured scale/paint costs justify it. |
| DOM with Canvas background | Can preserve HTML cards while drawing decoration separately. Adds synchronization and device-pixel-ratio complexity. | Possible later optimization if backgrounds are the measured bottleneck. |
| Three.js/WebGL | A scene-based graphics renderer; the current product has no 3D requirement. Does not remove event-indexing or scheduling work. | Not recommended for this use case. |

TanStack Virtual is headless and supports horizontal virtualization while leaving markup and styling under application control. That makes it compatible with this unusual calendar appearance. Its role would be rendering visible days plus an overscan margin. [TanStack Virtual introduction](https://tanstack.com/virtual/latest/docs/introduction?from=reactVirtualV2)

FullCalendar's TimeGrid places days horizontally and time vertically, and supports custom view durations. That is the relevant starting point for this calendar. Its Timeline view instead places time horizontally and resources in rows. [TimeGrid documentation](https://fullcalendar.io/docs/timegrid-view), [Timeline documentation](https://fullcalendar.io/docs/timeline-view)

FullCalendar documents dragging/resizing, external drops, independent snap granularity, and resizing from the starting edge. Hourly visual slots with 30-minute snapping are therefore an expressible configuration. A prototype must verify the merged half-day destination/stay headers and precise transport background transitions through public extension hooks; those customizations should not depend on patching internal markup. [Dragging and resizing](https://fullcalendar.io/docs/event-dragging-resizing), [snapDuration](https://fullcalendar.io/docs/snapDuration), [eventResizableFromStart](https://fullcalendar.io/docs/eventResizableFromStart), [day-lane hooks](https://fullcalendar.io/docs/day-lane-render-hooks)

FullCalendar Standard uses the MIT license; Premium has separate licensing. The product's use of the word “timeline” does not itself create a need for its Premium Timeline component. [FullCalendar license](https://fullcalendar.io/license)

Canvas is a bitmap surface and does not expose drawn objects as semantic HTML does. Replacing calendar controls with it requires an accessibility and focus solution. Konva's own performance guidance emphasizes reducing drawing and computation, controlling layer count, and avoiding unnecessary hit detection: a Canvas migration is not an automatic performance improvement. [MDN canvas accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas), [Konva performance guidance](https://konvajs.org/docs/performance/All_Performance_Tips.html)

Three.js organizes rendering around scenes, cameras, and a renderer. My assessment is that introducing this model would add more infrastructure than value for the current calendar. It could make sense for a materially different, very dense visual product after measurement, but there is no evidence here that a GPU renderer is necessary. [Three.js scene introduction](https://threejs.org/manual/en/creating-a-scene.html)

## Proposed DOM architecture

### Data and geometry

Compute a normalized view model when itinerary data changes: ordered days/stops, events indexed by day, transport transitions, and merged header intervals. Avoid date/time formatting and route reconstruction inside individual cell renders.

Use one geometry model for day width, time gutter, header heights, pixels per minute, scroll offsets, and event bounds. Hour lines remain hourly; moving and resizing snap to 30 minutes. Background diagonals and event bounds must derive from the same start/end coordinates, including half-hour boundaries.

Preserve the existing persisted duration, transport timezone behavior, revision checks, and rollback behavior. Explicitly cover overnight events and daylight-saving transitions; wall-clock placement and elapsed duration are different concepts.

### Rendering

Use a bounded calendar viewport with one native scrolling surface. Headers and the time gutter share its coordinate model and remain outside the event clipping region. Render cards in a dedicated positioned layer, rather than inside starting-hour cells. CSS Grid or positioned header bands can implement the shared widths; CSS Grid alone is not a guaranteed speedup.

Render hourly rules with CSS backgrounds where practical. Represent destination backgrounds as intervals and transport cuts as small SVG/CSS shapes, reducing repeated decorative elements. Preserve the empty top-left cutout and exact shared borders explicitly in the header layout.

For long trips, mount visible day columns plus overscan. Keep an event mounted whenever any of its interval intersects the viewport, even if its start is offscreen. With only 24 hour rows, vertical row virtualization is not the first priority. Keep focused or actively dragged items stable when columns enter or leave the viewport.

Large DOMs can increase layout cost, and interleaved geometry reads and writes can cause forced layout. Batch measurements before writes and validate the effect with a trace. [Browser layout guidance](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing?hl=en)

### Interaction

Use a shared interaction state machine for idle, hover, pan, move, resize-start, and resize-end. Pointer capture supports keeping a gesture attached to its target across mouse, touch, and pen movement. Card gestures take priority over background panning; cancellation, release, and lost capture must all clean up consistently. [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)

Keep pointer movement and temporary visual previews local. Schedule at most one visual preview update per animation frame; commit the durable schedule change at gesture completion. Update only the affected event and transport background during resizing. React should continue to own application state, dialogs, and persisted results.

Use one hover overlay and targeted header styles instead of changing every cell's appearance. The 250 ms dwell timer should cancel on exit, drag start, scroll, or capture changes. Manual selection should follow the same exit behavior requested for automatic selection.

Provide keyboard navigation, event editing, and non-drag alternatives. DOM rendering makes semantic controls possible but does not automatically implement an accessible interactive grid. Follow intentional focus management and keyboard behavior rather than giving every cell an independent tab stop. [WAI-ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

## Measurement and decision plan

First record the current implementation in a production build, separately from the development server. Use Chrome/Edge Performance recordings to distinguish JavaScript, layout, painting, and compositing. Use React profiling separately to locate expensive component updates. Profiling itself adds overhead, so do not mix those numbers with ordinary production timings. [Chrome Performance panel](https://developer.chrome.com/docs/devtools/performance), [React Profiler](https://react.dev/reference/react/Profiler)

Proposed datasets, not measured results:

| Scenario | Days | Activities/transports combined | Purpose |
| --- | ---: | ---: | --- |
| Typical short trip | 7 | 40 | Establish whether basic interaction already has unnecessary work. |
| Busy month | 30 | 300 | Check ordinary growth and overlap. |
| Extended trip | 90 | 1,500 | Test horizontal virtualization and data indexing. |
| Stress case | 365 | 5,000 | Locate limits; not an assumed product requirement. |

For each, record loading, rapid hover, stationary hover activation, horizontal/vertical panning, dragging from the pool, moving cards, both resize edges, overlapping transport options, offscreen-start events, and Alt-Tab return. Include the user's Windows browser, representative slower hardware, browser zoom, and display scaling. Check touch and keyboard behavior if those are supported product targets.

Proposed acceptance budgets:

- At 60 Hz, aim to fit continuous interaction work within the roughly 16.7 ms frame interval with browser headroom; target application work around 8 ms per frame initially.
- Avoid repeated main-thread tasks over 50 ms during gestures.
- After the intentional hover dwell, show feedback within one or two frames under the target workload.
- Hover must not trigger whole-trip data reconstruction or full-grid rendering work.
- Mounted day content should stay tied to viewport size when virtualization is enabled.
- Preserve geometry, half-hour snapping, revisions, timezone behavior, and accessibility during optimization.

These are proposed engineering targets, not promises or benchmark results. Frame time varies with refresh rate. Browser rendering guidance explains the limited per-frame budget and why smooth movement must be measured beyond discrete click responsiveness. [Rendering performance](https://web.dev/articles/rendering-performance)

## Suggested implementation order

1. Capture baseline traces and retain repeatable datasets.
2. Index events/transitions and remove repeated calculations; measure again.
3. Separate header, background, event, and interaction responsibilities using shared geometry; preserve the tested appearance.
4. Isolate previews and consolidate gesture handling; verify panning, hover, resize, and cancellation.
5. Introduce horizontal virtualization if viewport-independent work remains significant.
6. Compare a small FullCalendar prototype if maintaining custom scheduling still outweighs the cost of adapting the visual requirements. Adopt it only if the fit works through supported APIs and measured behavior is satisfactory.

The most defensible next investment is reducing unnecessary work and simplifying calendar geometry. Changing to Canvas or WebGL before measuring would replace the rendering system while potentially carrying the same underlying calculation and interaction problems into it.
