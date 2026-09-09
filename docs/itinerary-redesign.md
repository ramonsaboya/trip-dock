# Local itinerary redesign

Branch: `codex/trip-itinerary-planning`  
Worktree: `C:\Users\Ramon\.codex\worktrees\e27f\trip-dock`

The main checkout and its environment file are unchanged. Nothing is pushed or deployed.

## Run locally

Run this one command from the worktree:

```powershell
pnpm dev:itinerary
```

Open <http://localhost:3100>. The command starts Docker Desktop if needed, starts the separate database, applies migrations, and starts both app services in the same terminal. It sets the database connection and ports automatically. Press Ctrl+C to stop the app services; database data is retained.

The main app is unchanged. The preview uses database port 55433, API 4100 and web 3100. AI creation needs separately configured OpenAI credentials; manual creation and itinerary editing do not. No credentials were copied from the main checkout.

## Workspace layout

A centered horizontal trip timeline controls a connected strip of itinerary pages. Destination pages use most of the viewport; transport pages are narrower, revealing adjacent pages. The top timeline is static, centered, and wraps when necessary; only the selected page scrolls into the center. The page strip hides its scrollbar, spaces pages apart, and fades at the outer edges. Home is in the top bar, aligned with the workspace. No numeric page counter is shown. Native horizontal scrolling and swipe update the selected timeline item after settling. Previous/Next controls and arrow keys on the page strip support keyboard navigation; reduced-motion preferences disable smooth scrolling. Each destination keeps its calendar view when navigating away and back. The trip title and back control share a compact header, and the workspace uses the available screen width. Accommodation is a collapsed summary row above the activity calendar. The calendar has a compact idea pool, selectable dates, Day/Week views, and draggable notes on hourly rows. Destinations are numbered place markers in prominent green cards, with transport as smaller connecting links. Activity cards open the editor directly, without a separate Move button. Multiple activities at the same hour stack without overlap; no durations or booking facts are invented.

## Data model and migration review

`0002_salty_masked_marvel.sql` makes transport stop endpoints nullable and adds `from_location` / `to_location`. Each endpoint must be exactly one internal stop or a nonblank external location. At least one endpoint must be internal. The existing composite foreign keys still enforce trip ownership and destination deletion behavior. The GraphQL API also rejects identical stops and invalid endpoint combinations before writing.

Existing internal routes retain both stop IDs, positions, titles and timestamps. No destinations are added for home. No records are rewritten or deleted. Apply the migration before running the updated API/client. Older clients cannot represent external endpoints and should not be used after external journeys have been created. Reverting the schema would require first converting or removing external journeys; do not blindly restore NOT NULL constraints.

Activity assignment uses the existing nullable `scheduledAt` and `timezone`; booking status remains independent. New activities start in the idea pool. Moves retain IDEA, PLANNED, BOOKED or DONE, use the trip revision, and persist through the existing mutation. The calendar uses hourly drop targets from 00:00 through 23:00 in the activity timezone (device timezone if unset). Clicking an activity opens its editor for precise times, including minutes, or a change of destination. Day and Week views share the same persisted schedule. Exact times remain editable. Transport departure and arrival are expressed in one explicitly editable record timezone. Activities outside destination dates remain visible and movable. Destination dates are required to show its day schedule.

Creation renders a virtual next destination as soon as the previous name is typed. The virtual field is only added to the draft when typed into. Blank rows are excluded at save; one city inherits the trip boundaries. Multi-city date controls appear when needed, and differing or blocking destination dates remain editable. Traveler count is retained only for data/API compatibility.

## Validation

- `pnpm check` passed: 72 API tests and 57 web tests, lint, typecheck, API build and web build. The real-PostgreSQL test is intentionally skipped in the default suite and passed separately with `pnpm test:postgres`.
- Dedicated PostgreSQL checks use a disposable container on port 55432, separate from both main and preview databases. `TEST_DATABASE_URL` must point to its `tripdock_test` database; `pnpm test:postgres` resets that test schema.
- The same arrival/return and activity scheduling scenario runs against pg-mem and PostgreSQL, including multiple transports, invalid endpoints, foreign-trip stops, booked/completed activities, pool return and stale revisions.
- The PostgreSQL upgrade test inserts a route into the previous schema, applies the migration and verifies that record survives. It also verifies database endpoint constraints and repeatable migration application.
- Client tests cover blank trailing rows, single-day ranges, timezone grouping and DST-aware hourly moves.

Interactive browser/visual QA has not been performed. Touch and keyboard users can click an activity to edit its schedule because native HTML drag-and-drop support varies. Existing-trip AI editing and booking integrations are outside this change.
