# Dark-mode development

Run from your checkout after merging dark mode:

```powershell
cd C:\Users\Ramon\trip-dock
pnpm dev:dark-mode
```

Once both servers report ready, open `http://localhost:3300` in your own browser.
The command never opens a browser or a ChatGPT preview panel.

The command starts Docker Desktop if needed, starts an isolated PostgreSQL 17
container, applies migrations, copies the Rome trip on the first run, and starts
the API and web app. Existing dependencies must be installed (`pnpm install`).

| Service | Address |
| --- | --- |
| Web | `http://localhost:3300` |
| GraphQL API | `http://localhost:4300/graphql` |
| PostgreSQL | `127.0.0.1:55437`, database `tripdock_dark_mode` |

Press Ctrl+C to stop the app processes. PostgreSQL and your test edits remain in
the dedicated `tripdock-dark-mode_dark_mode_data` Docker volume. Restarting skips
the copy, even if you edited or deleted the copied trip. Occupied app ports cause
startup to fail rather than reuse a potentially unrelated server.

To stop the database without deleting its contents:

```powershell
docker compose -f compose.dark-mode.yaml stop
```

## Initial data copy

This checkout's test database has already been populated with **Trip to Italy**
(`072f42fe-6e9a-44de-babb-70f84af87336`): Rome, Maiori, and Naples, with four
transport legs and seven activities. There were no stays or packing tables in
that source. The default main database was empty, so the actual source was the
existing `tripdock_itinerary` database on port `55433`.

On a fresh machine, the copy normally reads the root `.env` / process
`DATABASE_URL`. To use the same itinerary source before the first copy:

```powershell
$env:DARK_MODE_SOURCE_DATABASE_URL = 'postgresql://tripdock:tripdock@127.0.0.1:55433/tripdock_itinerary'
pnpm dev:dark-mode
```

The source database must be running. Selection matches Rome/Roma in the trip or
its stops. If several trips match, startup lists their IDs; set
`DARK_MODE_TRIP_ID` to select one explicitly. No arbitrary match is chosen.

The source is read in a consistent, read-only transaction and is never migrated
or edited. The copy includes stops, transport, stays, activities, and existing
packing plans with the profiles and library records they need. It commits
atomically, retaining IDs, timestamps, and booking states. Legacy AI proposal
history is not used by the current app and is not copied. No data dump is saved
to the repository.

To prepare the database without launching either app server:

```powershell
pnpm dev:dark-mode --setup-only
```

## Try dark mode

Open the copied trip and check Schedule and Packing. Use the header theme button
to compare dark and light mode, reload to verify your choice persists, and open
an activity or create-trip dialog to check inputs and date controls. Test edits
are saved only to the isolated database.
