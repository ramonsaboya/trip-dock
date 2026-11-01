# TripDock MVP review — 9 September 2026

Recommendation: finish a reliable, narrow trip-creation and itinerary loop, validate it with real trips, and then open a private pilot. Preserve the current architecture. The highest-value next change is implementing the latest nights-based creation contract, not adding another integration or doing more general AI research.

This is a review and proposed backlog, not authorization to deploy or a replacement for previously agreed product requirements.

## Evidence and access

Reviewed current source, repository documentation, all local and remote-tracking branches, GitHub's live branch list, local task metadata, and relevant accessible task histories covering the prototype, PostgreSQL implementation, date autofill, creation refinement, AI evaluation, simplification research, and Splitwise research. Checked the original PostgreSQL implementation brief.

The app exposed recent ChatGPT conversations, but its task listing is limited to 50 entries and does not provide exhaustive account-wide search. No claim is made to have reviewed all ChatGPT history, inaccessible cloud tasks, or uncommitted work on the MacBook. Related historical agent conclusions were checked against current code; proposals were not treated as implemented features.

`pnpm check` passed: 123 tests passed, one optional PostgreSQL test skipped; lint, typechecks and both production builds passed. The first sandboxed attempt failed on Windows user lookup; the unrestricted retry succeeded. Checks ran on the available Node 24.19.0, not the repository's pinned Node 22.23.2. This review did not run live model evaluations, real PostgreSQL verification, Safari/mobile browser testing, or a deployed end-to-end flow.

## Branch audit

| Branch/reference | Commit | Finding |
| --- | --- | --- |
| GitHub `main` / local `origin/main` | `c98a6c4` | Latest implementation. |
| Local and GitHub `codex/ai-trip-creation-system` | `c98a6c4` | Same commit as remote main; current checkout. |
| Local and GitHub `codex/tripdock-postgres-graphql-ai` | `9c83d55` | Fully included in main; five commits behind it, zero unique commits. |
| Local `main` | `9f4ad99` | Stale local pointer, 11 commits behind remote main. |
| Retained `sites/main` reference | `8ad8373` | Historical source lineage, fully included in current main; no configured Sites Git remote to verify separately. |

GitHub reports exactly three branch heads. One local worktree is registered. The working tree was clean before this report. No branch merge is needed to recover features. Fast-forward local main before starting the next implementation branch; retire old branches only as deliberate housekeeping. No branches were changed by this review.

## What is already useful

- Real persisted trip, destination, transport, accommodation and activity editing.
- PostgreSQL migrations, transactions, trip revisions and rejection of stale edits.
- AI-generated drafts that remain editable and unpersisted until explicitly created.
- Locale/reference-date handling, evidence checks, error handling and manual fallback.
- An existing responsive interface and deterministic tests.
- A versioned live-evaluation runner with four semantic regression scenarios.

Preserve these foundations. Existing-trip AI was deliberately removed. Its legacy database tables are migration history, not a reason to restore that feature or rewrite the schema.

## Gaps ranked by MVP impact

### 1. The latest creation requirements are still a research outcome

In “Simplify AI trip creation,” the latest user clarification narrowed creation to title/area and destinations with dates. It also required zero-night visits, nights-based durations, structured answers where possible, and removal of traveler count.

Current implementation differs:

- `apps/api/src/trip-creation.ts:2042` checks a resolved city, overall dates and blocking questions; it does not require every destination to have resolved dates. Destination-date errors are explicitly nonblocking around line 1893.
- `apps/api/src/trip-creation.ts:88` defines duration values with a minimum of one. Database date ranges already permit equal dates, so zero-night support is inconsistent across layers rather than wholly absent.
- Traveler count remains in extraction and UI, including `apps/web/components/trip-dock-app.tsx:1348`.
- Clarifications support radio options and direct field updates, but missing answers fall back to a shared message rather than destination night inputs/date controls (`trip-dock-app.tsx:1225`).
- Follow-ups reconstruct a conversational prompt (`apps/web/lib/graphql-client.ts:1095`) and align destinations using names/indexes. Repeated-place identity needs particular care.

Next: implement a narrow date-propagation model with stable draft destination IDs, numeric nights inputs allowing zero, structured date answers, and shared readiness rules for AI, manual UI and server persistence. Infer only uniquely determined dates; ask when facts conflict or several schedules fit. Keep vague seasons as focused date questions. Do not build a universal holiday parser or general itinerary optimizer.

Title suggestions should not become a blocker. Hide traveler count from the MVP flow and extraction; dropping its persisted column is unnecessary launch work.

### 2. The transport model misses arrival and return journeys

`apps/api/src/db/schema.ts:79` requires both endpoints to reference internal destination stops. The UI also chooses endpoints exclusively from those stops. This cannot honestly represent home → first destination or last destination → home; a single-destination trip has no valid distinct-stop route.

Next: add a small explicit external-endpoint representation and manual inbound/outbound transport editing. Do not fake home as a holiday destination. Keep booking details optional. Handle overnight travel without assuming all trip nights belong to destination stays. Do this after creation; do not expand AI creation into extracting bookings, stays and activities.

### 3. Green automated checks do not establish the real user journey

The live corpus has four English scenarios. Web tests predominantly exercise helpers and include source-text assertions for UI structure (`apps/web/tests/graphql-client.test.ts:1476`), rather than driving a browser. That is useful coverage, but it cannot establish modal navigation, mobile usability or real AI quality.

Next: retain the four live scenarios and add a few distinct cases directly tied to the new contract: missing destination nights, zero-night visit, contradictory allocation, repeated destination correction, vague date clarification and preservation of manual edits. Avoid near-duplicate prompt expansion or an evaluation platform project.

Add a small browser smoke covering create → clarify → review → save → edit → reload. Run real PostgreSQL migration/persistence checks. Record live model results, latency and failures on the configured machine before declaring AI ready.

### 4. Local readiness and external-user readiness are separate milestones

The API has no authentication or user ownership boundary. Child-to-trip foreign keys protect data consistency; they do not isolate different users. The server binds to loopback. Deployment and operations are explicitly deferred in the repository.

For a personal MVP, retain that local scope and validate the product first. For independent external testers, add a small hosted pilot with authentication, per-user authorization on every query/mutation, protected AI access with usage limits, database backup/restore, and basic error visibility. A login page by itself is insufficient. A supervised demo on your machine does not need this milestone.

Provider selection and infrastructure design should be time-boxed when the pilot is needed. The existing Sites/Vinext scaffold does not establish that the current PostgreSQL-backed product is deployed or ready to share.

## Proposed execution sequence

1. **One short planning session:** record a single MVP contract in the repository using the latest explicit user decisions; amend stale README/prototype claims. State whether the release target is personal use or independent external testing. No broad architecture research.
2. **First implementation slice:** nights-based creation, zero-night support, structured clarifications, stable draft IDs, consistent save validation, traveler-field removal from the experience. Reuse current extraction and persistence. Finish the corresponding regression checks in the same slice.
3. **Second implementation slice:** inbound/outbound transport; verify existing multiple stays and activities with a real itinerary. Group scheduled activities by day if the current list prevents practical use; defer drag-and-drop calendars and richer scheduling.
4. **Validation slice:** use three real trips, run browser and PostgreSQL checks, execute the focused live corpus, fix only blockers. Include single-destination and multi-destination trips, date correction, reload, and AI failure with manual completion.
5. **External pilot only if required:** add the access and operating essentials above, then have 3–5 people plan an actual trip without agent assistance.

These are completion gates, not calendar promises. Aim to finish and assess each slice in days rather than keep several speculative branches open. If a slice expands, cut optional behavior and preserve the usable path.

## MVP acceptance bar

- A person can describe a single- or multi-destination trip and finish missing essentials through clear controls.
- Every destination has valid dates before creation; zero nights is supported; conflicts are explained rather than silently invented away.
- A failed AI request still leaves a usable manual creation route.
- The person can save, reopen, correct dates, and maintain transport, stays and activities without losing changes.
- A single-destination trip can include travel there and back.
- Real PostgreSQL and browser tests pass; focused live model checks are recorded.
- For an external release, an independent second user cannot access the first user's trips, and backup recovery has been tested.

## Deliberate cuts

Defer Splitwise integration, WhatsApp, voice, booking imports/providers, uploads, expense accounting, maps, notifications, collaborative editing, AI editing of existing trips, broad model comparisons and framework migration. Splitwise can remain an external tool until expense handoff is shown to block the core use case.

The main process risk is drift between rich task discussions and the contract actually implemented. Keep a short current specification and a checked-off release checklist in Git. Use research notes as references, not as an accumulating implementation backlog. Success is a real trip planned and maintained with little assistance, not a larger number of AI features or tests.
