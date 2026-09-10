# Local itinerary redesign

Branch: `codex/trip-itinerary-planning`  
Worktree: `C:\Users\Ramon\.codex\worktrees\e27f\trip-dock`

The tested itinerary changes are merged into local main. Environment files remain separate. Nothing is pushed or deployed.

## Run locally

Run this one command from the worktree:

```powershell
pnpm dev:itinerary
```

Open <http://localhost:3100>. The command starts Docker Desktop if needed, starts the separate database, applies migrations, and starts both app services in the same terminal. It sets the database connection and ports automatically. Press Ctrl+C to stop the app services; database data is retained.

The preview uses database port 55433, API 4100 and web 3100. AI creation needs separately configured OpenAI credentials; manual creation and itinerary editing do not. No credentials were copied from the main checkout.

## Workspace layout

The itinerary always spans the whole trip. Every date appears once. The destination and stay bands divide shared transfer dates halfway across the day column. Pale destination colors alternate diagonal stripes, dots, stars and grids. On transfer days, hourly backgrounds follow the previous destination before travel, blend diagonally between both textured papers during travel, and adopt the next destination after arrival. Dropping an activity on a shared date preserves its destination.

The calendar sits on the left with the Activity idea pool on the right. The pool contains only activity ideas and the add-activity button. Destination-add controls and the redundant calendar toolbar are removed. Clicking a half-hour cell, or resting the pointer there for 1.4 seconds, adds a soft neutral highlight and a full-cell plus overlay for activity creation with its date and time prefilled. The workspace fills the viewport with no outer page scroll. The idea pool matches the calendar height. All calendar scrollbars are hidden. Dragging empty calendar space pans in both directions, while notes retain their activity drag behavior and buttons remain clickable. Activity and transport notes take priority over panning when dragged; transport moves preserve route details and known elapsed duration. Wheel, touch and keyboard scrolling remain available. A single table groups destination headings above the weekday/date row, with a regular stay row between destination headings and dates, merged at exactly the same city boundaries; each city has one merged stay cell containing its stays. Confirmed local check-in and check-out dates control coverage; checkout does not count as another night. Missing dates use the destination range and are marked for confirmation. Unplaced stays and transport remain accessible under Dates to review.

Transport appears as large terracotta notes at its recorded local departure hour (arrival hour if only arrival is available). Multiple records split side by side. Two-hour placeholders are continuous, full-width cards across both rows. Diagonal paper boundaries have a gray dividing line. The pattern sequence separates opposite diagonals with dots. There is no special Travel row. With no timestamp, a destination boundary provides a suggested day and an explicitly marked 10 a.m.–12 p.m. placeholder in the regular hourly grid; those display defaults are not saved as booking facts. Arrival, transfers and return journeys each retain add controls. The initial scroll shows 9 a.m. or the earliest recorded activity/transport hour among the visible days, whichever is earlier. The page strip and scrolling timeline are removed. Home remains in the aligned top bar.

## Data model and migration review

`0003_rich_banshee.sql` adds persisted activity duration in minutes, defaulting existing activities to 60 minutes. API and database bounds reject invalid durations. Top and bottom card handles resize in half-hour steps, with top resizing preserving the end time, save through revision-checked mutations, and support keyboard arrows. Resizing a route placeholder creates a planned transport record with those times; transport resizing saves arrival time. Activity moves and edits retain duration. Cards use one surface with a top-right remove button, and successful moves no longer add status text below the table.

`0002_salty_masked_marvel.sql` makes transport stop endpoints nullable and adds `from_location` / `to_location`. Each endpoint must be exactly one internal stop or a nonblank external location. At least one endpoint must be internal. The existing composite foreign keys still enforce trip ownership and destination deletion behavior. The GraphQL API also rejects identical stops and invalid endpoint combinations before writing.

Existing internal routes retain both stop IDs, positions, titles and timestamps. No destinations are added for home. No records are rewritten or deleted. Apply the migration before running the updated API/client. Older clients cannot represent external endpoints and should not be used after external journeys have been created. Reverting the schema would require first converting or removing external journeys; do not blindly restore NOT NULL constraints.

Activity assignment uses the existing nullable `scheduledAt` and `timezone`; booking status remains independent. New activities start in the idea pool. Moves retain IDEA, PLANNED, BOOKED or DONE, use the trip revision, and persist through the existing mutation. The calendar uses half-hour drop targets from 00:00 through 23:30 in the activity timezone (device timezone if unset). Clicking an activity opens its editor for precise times, including minutes, or a change of destination. The whole-trip calendar uses the persisted schedule. Exact times remain editable. Transport departure and arrival are expressed in one explicitly editable record timezone. Activities outside destination dates remain visible and movable. Destination dates are required to show its day schedule.

Creation renders a virtual next destination as soon as the previous name is typed. The virtual field is only added to the draft when typed into. Blank rows are excluded at save; one city inherits the trip boundaries. Multi-city date controls appear when needed, and differing or blocking destination dates remain editable. Traveler count is retained only for data/API compatibility.

## Validation

- Latest calendar refinement: 71 web tests, lint, typecheck and production web build. Browser interaction and visual QA remain unperformed.

- `pnpm check` passed: 72 API tests and 63 web tests, lint, typecheck, API build and web build. The real-PostgreSQL test is intentionally skipped in the default suite and passed separately with `pnpm test:postgres`.
- Dedicated PostgreSQL checks use a disposable container on port 55432, separate from both main and preview databases. `TEST_DATABASE_URL` must point to its `tripdock_test` database; `pnpm test:postgres` resets that test schema.
- The same arrival/return and activity scheduling scenario runs against pg-mem and PostgreSQL, including multiple transports, invalid endpoints, foreign-trip stops, booked/completed activities, pool return and stale revisions.
- The PostgreSQL upgrade test inserts a route into the previous schema, applies the migration and verifies that record survives. It also verifies database endpoint constraints and repeatable migration application.
- Client tests cover blank trailing rows, single-day ranges, timezone grouping and DST-aware hourly moves.

Interactive browser/visual QA has not been performed. Touch and keyboard users can click an activity to edit its schedule because native HTML drag-and-drop support varies. Existing-trip AI editing and booking integrations are outside this change.

The grid uses hourly rows with half-hour placement inside each row with activity titles first. Hover crosshairs identify the date and time; panning clears selection. Drag previews cover the full duration and retain the grabbed offset within the card. Live transport paper follows exact half-hour card boundaries during resize. Destination and stay headers leave the time-gutter corner empty. Trip dates sit beside the title.

The upper-left header gutter is clipped out of the viewport with a rounded destination corner until horizontal scrolling reveals the header behind it. Hover highlighting updates only the affected DOM classes; cached paper calculations no longer run for every pointer move. Pointer time uses one body measurement rather than scanning all rows.
