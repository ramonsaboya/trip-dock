# Local itinerary redesign

Branch: `codex/trip-itinerary-planning`  
Worktree: `C:\Users\Ramon\.codex\worktrees\e27f\trip-dock`

The main checkout and its environment file are unchanged. Nothing is pushed or deployed.

## Run locally

Use PowerShell in this worktree. The separate Compose project uses database port **55433**, API **4100**, and web **3100**. Its database and volume are separate from the main app.

First terminal:

```powershell
docker compose -f compose.itinerary.yaml up -d --wait
$env:DATABASE_URL='postgresql://tripdock:tripdock@127.0.0.1:55433/tripdock_itinerary'
pnpm db:migrate
$env:API_PORT='4100'
$env:WEB_ORIGIN='http://localhost:3100'
pnpm --filter @tripdock/api dev
```

Second terminal, also in this worktree:

```powershell
$env:NEXT_PUBLIC_GRAPHQL_URL='http://localhost:4100/graphql'
pnpm --filter @tripdock/web dev --port 3100
```

The preview was started and verified with HTTP 200; its API connected to the empty isolated database. Open <http://localhost:3100>. AI creation needs separately configured OpenAI credentials; manual creation and itinerary editing do not. No credentials were copied from the main checkout.

Stop the two terminal processes with Ctrl+C. To stop the isolated database while keeping its data:

```powershell
docker compose -f compose.itinerary.yaml stop
```

## Data model and migration review

`0002_salty_masked_marvel.sql` makes transport stop endpoints nullable and adds `from_location` / `to_location`. Each endpoint must be exactly one internal stop or a nonblank external location. At least one endpoint must be internal. The existing composite foreign keys still enforce trip ownership and destination deletion behavior. The GraphQL API also rejects identical stops and invalid endpoint combinations before writing.

Existing internal routes retain both stop IDs, positions, titles and timestamps. No destinations are added for home. No records are rewritten or deleted. Apply the migration before running the updated API/client. Older clients cannot represent external endpoints and should not be used after external journeys have been created. Reverting the schema would require first converting or removing external journeys; do not blindly restore NOT NULL constraints.

Activity assignment uses the existing nullable `scheduledAt` and `timezone`; booking status remains independent. New activities start in the idea pool. Moves retain IDEA, PLANNED, BOOKED or DONE, use the trip revision, and persist through the existing mutation. Slot assignment uses visible suggested times of 09:00, 14:00 and 19:00 in the activity timezone (device timezone if unset). Exact times remain editable. Transport departure and arrival are expressed in one explicitly editable record timezone. Activities outside destination dates remain visible and movable. Destination dates are required to show its day schedule.

Creation renders a virtual next destination as soon as the previous name is typed. The virtual field is only added to the draft when typed into. Blank rows are excluded at save; one city inherits the trip boundaries. Multi-city date controls appear when needed, and differing or blocking destination dates remain editable. Traveler count is retained only for data/API compatibility.

## Validation

- `pnpm check` passed: 72 API tests and 56 web tests, lint, typecheck, API build and web build. The real-PostgreSQL test is intentionally skipped in the default suite and passed separately with `pnpm test:postgres`.
- Dedicated PostgreSQL checks use a disposable container on port 55432, separate from both main and preview databases. `TEST_DATABASE_URL` must point to its `tripdock_test` database; `pnpm test:postgres` resets that test schema.
- The same arrival/return and activity scheduling scenario runs against pg-mem and PostgreSQL, including multiple transports, invalid endpoints, foreign-trip stops, booked/completed activities, pool return and stale revisions.
- The PostgreSQL upgrade test inserts a route into the previous schema, applies the migration and verifies that record survives. It also verifies database endpoint constraints and repeatable migration application.
- Client tests cover blank trailing rows, single-day ranges, timezone grouping and DST-aware slot moves.

Interactive browser/visual QA has not been performed. Touch users have the Move form because native HTML drag-and-drop support varies. Existing-trip AI editing and booking integrations are outside this change.
