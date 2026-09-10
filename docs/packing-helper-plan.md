# Trips and Packing: implementation brief

Prepared 10 September 2026. Status: first version implemented on codex/packing-helper after itinerary completion. See [implementation and verification](packing-implementation.md) for delivered behavior and recorded adjustments to this design brief.

## Intended first version

TripDock gains two prominent choices in the app's top bar: **Trips** and **Packing**. Trips keeps the current itinerary experience. Packing is a separate workspace: select an existing trip, assign activity tags to its dates, then generate a persistent, editable packing checklist. A personal library supplies editable starter tags and items and supports custom entries.

The initial calculation is deterministic. It combines daily essentials with items needed for tagged days, handles simple reuse intervals, and explains quantities. Tag combinations, weather, laundry scheduling, automatic extraction from itinerary activities, shared luggage, and outfit optimization are later work.

This brief records implementation defaults, not preferences already confirmed by the user. In particular: one person's list per trip, inclusive trip days, pajamas every three nights, and a local personal profile until accounts exist.

## Verified starting point and dependency

Update: the itinerary work is now pushed to main. Continue packing against `origin/main`, verified at `eb10981c9334f98b0e7c584cb27974fd3cb0a687`. The packing branch tracks `origin/main`; the task dependency and checkout details below are historical research context and no longer govern the base branch.

- Main checkout: `C:/Users/Ramon/trip-dock`.
- Active source task: **Redesign TripDock itinerary and trip…**, ID `01a0870a-a248-71e0-bd5c-859ba872d176`, host `local`.
- That task actually works in `C:/Users/Ramon/.codex/worktrees/e27f/trip-dock`, branch `codex/trip-itinerary-planning`. Do not confuse it with the older `codex/trip-itinerary-redesign` checkout at `.worktrees/itinerary`.
- At inspection, source and main shared commit `e7b9e8f`; source had an ongoing edit to `apps/web/lib/trip-calendar.ts`. This is research evidence, **not** the commit to fork automatically.
- `docs/itinerary-redesign.md` documents the delivered itinerary and its isolated preview. Read its final version again before implementation.
- The main checkout already contained an unrelated untracked `docs/mvp-review-2026-09-09.md`. Preserve it.

Wait for a successful completion of the source task's current work, rather than treating idle, an error, or an approval request as completion. Inspect its delivered branch and final verification notes. Recheck task status immediately before branching. Fork the final committed source into `codex/packing-helper` in an isolated worktree, preferably `C:/Users/Ramon/trip-dock/.worktrees/packing-helper`. Record the exact base commit. Do not switch or modify the source checkout, copy its secrets, or start from the older redesign branch. If relevant final changes remain uncommitted, establish their delivered status before choosing a snapshot; do not silently omit them or commit someone else's work.

Copy this brief into the new worktree. Implement and verify there. Leave a reviewable local candidate, with exact run instructions and any limitations. Integration into main, pushing and deployment are separate later steps.

## Repository findings

| Existing component | Implication for packing |
| --- | --- |
| React 19 / Vinext web app; `apps/web/components/trip-dock-app.tsx` holds the shell and trip selection | Add the top-level switch in that shell; keep packing components separate from the large itinerary component. |
| `apps/web/app/page.tsx`, `apps/web/app/globals.css` | Reuse the existing visual language, header dimensions, dialogs, typography and responsive behavior. |
| `calendarColumns` in `apps/web/lib/trip-calendar.ts`; date enumeration in `activity-planning.ts` | Packing uses each trip date once, including transfer days. Destinations may decorate a date but never multiply it. |
| PostgreSQL via Drizzle, GraphQL Yoga, Zod input validation | Save packing data through the API into the existing database. Browser storage is not the canonical library or checklist. |
| `apps/api/src/db/schema.ts`, `data.ts`, `graphql.ts` | Add explicit packing entities and a focused packing service; reuse established error and transaction conventions. |
| Revision checks and row locking around trip mutations | Packing needs equivalent protection, with separate library and packing-plan revisions to avoid conflicts with unrelated itinerary edits. |
| No user/account table or authenticated request identity found in the inspected API | Ownership needs an explicit design. A client-supplied account ID is not authentication. |
| Deterministic tests, pg-mem and a separate PostgreSQL migration suite | Verify the calculator, persistence, ownership boundaries, stale updates and actual migrations. |

No package upgrade or external service is necessary for this feature. Revalidate file locations and migration numbering against the finished branch.

## Product flow and screen structure

1. **Top bar:** logo, Trips, Packing. Switching back to Trips restores the selected itinerary during the session. The logo opens Trips home. Packing does not reuse the itinerary's idea pool or calendar editing controls.
2. **Packing home:** trip selector with name, destination and dates; a clear empty state linking to trip creation if there are no trips. The library remains accessible without a trip.
3. **Trip packing:** heading and trip selector, a Days / Packing list view choice, and a secondary Library action. The two global choices remain visually dominant.
4. **Days:** date cards or compact rows with weekday, date, optional destination labels, and removable tag chips. Search the tag picker; create a tag there; select several days to apply a tag in one action. No activities are inferred automatically.
5. **Generate packing list:** explicit primary action. Generating includes baseline essentials even if the trip has no activity tags. The button states whether this is the first generation or a recalculation.
6. **Checklist:** items grouped by category, search, packed progress, editable target quantities, packed quantities or checkboxes, Add item, Exclude, and an expandable explanation for each suggestion.
7. **Library:** Items and Tags views. Item editor contains category, checkbox/quantity mode, baseline toggle and simple quantity rule. Tag editor lets users link existing items or create one. Editing a default changes this profile's copy.

Use the existing warm paper/terracotta design. On desktop, days and a compact summary can sit side by side; on phones use a single column with Days / Packing list views. Keep primary controls reachable without horizontal page overflow. Avoid making a permanent sidebar compete with the new global navigation.

Use semantic tab buttons if these are in-place panels: labelled tablist, selected state, associated panels, roving focus, left/right arrows and Enter/Space activation. Preserve dialog keyboard behavior and visibly indicate focus. Manual activation suits panels that may fetch data. If implementation instead uses distinct URLs, use navigation links with current-page semantics. These alternatives follow the distinction in the [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/); choose one consistent interaction model.

Show loading, save failure with retry, empty library, unavailable trip, no tagged days, and stale-list states. A failed save must not look successful. A stale revision refreshes data and offers retry rather than silently replacing another edit.

## Ownership and persistence

First local version: create one persisted personal packing profile via a server-owned local identity adapter. All packing reads and writes resolve that profile on the server. There is no public profile-switching parameter. Describe this honestly as a local personal library, not a finished multi-account system.

Design every packing entity with ownership from the start. When real authentication is added, connect profiles to authenticated users and add trip ownership/membership authorization across the existing API. This requires a separate account implementation; adding an `ownerId` column alone does not make the current trip API multi-user safe. Test packing services with two injected profile identities so isolation is verifiable already.

Proposed tables (names can follow final repository conventions):

| Table | Important fields and behavior |
| --- | --- |
| `packing_profiles` | ID, display name, catalog version, library revision, timestamps. Future authenticated-user link stays explicit. |
| `packing_categories` | ID, profile ID, name, normalized name, position, archived flag. Starter categories plus custom categories. |
| `packing_items` | ID, profile ID, category ID, name, normalized name, mode `CHECKBOX` or `QUANTITY`, baseline enabled, quantity per interval, interval length, basis `DAYS` or `NIGHTS`, archived flag, optional starter key. |
| `packing_tags` | ID, profile ID, name, normalized name, color/icon from a small safe set, archived flag, optional starter key. |
| `packing_tag_items` | Profile ID, tag ID, item ID; unique association. In v1 this link selects qualifying dates; the item's rule controls quantity. |
| `packing_plans` | ID, profile ID, trip ID, revision, generated-from input fingerprint, algorithm version, generated timestamp; unique profile/trip. |
| `packing_day_tags` | Plan ID, profile ID, ISO calendar date, tag ID; unique plan/date/tag. |
| `packing_list_entries` | Plan ID, profile ID, item ID, generated quantity, nullable manual quantity override, packed quantity, excluded flag, manual-add flag, explanation JSON and name/category snapshots. Unique plan/item. |

Use foreign keys and compound ownership references so an association cannot join another profile's items, tags or plan. Database constraints enforce unique links, required fields and valid numeric ranges. Profile-scoped normalized names prevent accidental duplicates; item uniqueness can be within a category, tag uniqueness within the profile. IDs remain identity even after a rename. Archive referenced library entries instead of destructive cascades. Existing saved lists retain snapshots and packing progress until deliberately refreshed.

Use PostgreSQL `date` for assigned trip days. It represents a calendar date without a time zone; do not convert packing dates through the device's local midnight. [PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)

Validate a day against the locked trip's current start/end dates in the service. A normal CHECK constraint is not a reliable mechanism for validating values against another table's changing rows. Use transactions and foreign keys for relational integrity, following [PostgreSQL constraint guidance](https://www.postgresql.org/docs/current/ddl-constraints.html).

Trip deletion cascades the corresponding plan and its entries, preserving the personal library. Shortening a trip keeps out-of-range assignments for review but excludes them from calculations; show a Dates outside this trip notice with a remove action. Extending a trip creates visible untagged dates and marks an existing list stale. Changing stop boundaries alone does not add days.

## Simple, explicit calculation contract

All quantities are for **one person**. Do not multiply by the existing traveler count. For a trip from start through end, day count is inclusive and night count is day count minus one. A day trip therefore has one day and zero nights.

Each item has one editable rule. This deliberately avoids conflicting per-tag formulas in v1. Item-to-tag associations select dates on which that item is needed. The baseline toggle additionally selects every trip day (or every trip night for night-based rules).

1. Enumerate the valid calendar dates once.
2. For each active item, take the union of dates selected by all its active tags. If baseline is enabled, include all dates. A repeated tag or multiple tags requesting the same item on the same date do not multiply the need.
3. For a night rule, keep only dates that start a trip night: every date except the last. Otherwise use the matching calendar dates.
4. Checkbox item: suggest one if there is at least one eligible date, otherwise zero. Its quantity and interval controls are hidden.
5. Quantity item: `ceil(eligibleDateCount / intervalLength) * quantityPerInterval`. Count distinct eligible dates, including nonconsecutive dates. For example, reuse across every two hiking days means tagged days, not elapsed calendar gaps.
6. Group by item ID, filter zero suggestions, and order by category then name. Attach the rule, baseline contribution, matching dates and contributing tags as structured explanation data.

This is simple overlap deduplication, not an outfit or tag-combination engine. Beach plus fancy dinner does not automatically replace casual clothing. The user can adjust or exclude an item. Reuse intervals are editable personal defaults, not universal packing advice.

Validate integers before calculation: quantity per interval 1–100, interval length 1–365, manual and packed quantities 0–9999. Reject overflow rather than silently truncating. For checkbox items restrict effective target and packed count to 0 or 1. Trim names, require nonblank values, set reasonable name lengths, and reject invalid calendar dates.

### Starter baseline rules

| Item | Initial mode/rule | Default inclusion |
| --- | --- | --- |
| Underwear | Quantity, 1 every day | Baseline |
| Socks | Quantity, 1 pair every day | Baseline, easy to disable |
| Everyday tops | Quantity, 1 every day | Baseline |
| Casual trousers | Quantity, 1 every 3 days | Baseline, easy to disable |
| Pajamas | Quantity, 1 set every 3 nights | Baseline; zero for a day trip |
| Stay-at-home clothes | Quantity, 1 set every 3 nights | Available; opt-in baseline |
| Toothbrush, toothpaste, deodorant | Checkbox, once | Baseline |
| Phone, phone charger, wallet | Checkbox, once | Baseline |
| Glasses, contact lenses, personal medication | Personal rules | Available; opt-in, no dosage inference |

### Representative activity mappings

| Tag | Initial linked items |
| --- | --- |
| Beach day | Swimwear: 1 every 2 tagged days; sunglasses, sun hat, sunscreen, beach towel: once |
| Pool / spa | Swimwear with the same rule; flip-flops: once |
| Fancy dinner | Fancy trousers: 1 every 2 tagged days; smart top: 1 per tagged day; smart shoes: once |
| Nightclub | Fancy trousers: same reusable item; going-out top: 1 per tagged day; small bag: once |
| Hiking | Hiking shirt and hiking socks: 1 per tagged day; hiking trousers: 1 every 2 tagged days; boots, daypack, water bottle, rain shell: once |
| Skiing | Thermal top and leggings: 1 every 2 tagged days; ski socks: 1 per tagged day; ski jacket, ski trousers, gloves, goggles: once |
| Museums | Comfortable walking shoes, day bag: once |
| Formal event | Suit, formal shoes: once; formal shirt: 1 per tagged day |
| Gym | Workout top and bottoms: 1 per tagged day; trainers: once |
| Work meeting | Smart top: same item as dinner; laptop, laptop charger: once |

Optional alternatives stay in the catalog without all being suggested together. Start with a generic Swimwear item; Bikini and Swim shorts can replace it through editing tag links. Likewise a dress, skirt, suit or trousers is a personal choice. Do not infer gender, body needs or travel document requirements.

### Worked example and expected results

Trip: 10–14 September, five days/four nights. Beach on the 11th and 12th; Pool on the 12th; Fancy dinner on the 11th and 13th; Nightclub also on the 13th; Hiking on the 14th.

| Item | Expected quantity | Reason |
| --- | --- | --- |
| Underwear | 5 | Five inclusive baseline days |
| Pajamas | 2 | `ceil(4 / 3)` trip nights |
| Casual trousers | 2 | `ceil(5 / 3)` baseline days |
| Swimwear | 1 | Two distinct eligible days, reused every two; Pool does not count the 12th twice |
| Sunglasses | 1 | Presence item requested by Beach |
| Fancy trousers | 1 | Two distinct dinner/nightclub dates, reused every two |
| Smart top | 2 | Two dinner dates |
| Going-out top | 1 | One nightclub date |
| Hiking shirt | 1 | One hiking date |
| Phone charger | 1 | Baseline presence item |

## Starter catalog breadth

Seed templates once per profile using stable starter keys and a catalog version. Bootstrap categories, items, tags and links in one transaction with unique constraints so repeated or concurrent initialization creates no duplicates. These are editable templates, not fixture trips. Never overwrite a user's changes when catalog versions change.

Suggested starter tags (30): Beach day, Pool / spa, Fancy dinner, Nightclub, Museums, City walking, Hiking, Skiing, Snowboarding, Camping, Cycling, Running, Gym, Yoga, Boat day, Snorkeling, Surfing, Theme park, Festival, Concert / theatre, Formal event, Wedding, Work meeting, Remote work, Long-haul flight, Train travel, Road trip, Rainy day, Cold day, Relaxing indoors.

Every visible starter tag must have useful reviewed item links. A tag with no links can exist as a user's newly created tag, but should state that it currently adds no items. Rules for the remaining starter tags follow the same basic presence/daily/reuse model; do not invent new formula types for each activity.

| Category | Starter items available to customize |
| --- | --- |
| Everyday clothing | Everyday tops, casual trousers, shorts, jeans, skirt, dress, underwear, bras, socks, pajamas, stay-at-home clothes, sweater, rain shell, light jacket |
| Smart clothing | Fancy trousers, smart top, going-out top, formal shirt, suit, formal dress, tie, belt |
| Swim and beach | Swimwear, bikini, swim shorts, cover-up, beach towel, sun hat, sunglasses, flip-flops |
| Outdoor and sport | Hiking shirt, hiking trousers, hiking socks, thermal top, thermal leggings, ski jacket, ski trousers, ski socks, gloves, beanie, goggles, workout top, workout bottoms, cycling shorts, helmet, yoga mat |
| Footwear | Walking shoes, smart shoes, formal shoes, trainers, hiking boots, sandals |
| Bags and accessories | Day bag, daypack, small bag, dry bag, reusable water bottle, umbrella, laundry bag, earplugs, sleep mask, neck pillow, travel towel |
| Electronics | Phone, phone charger, USB cable, power bank, plug adapter, laptop, laptop charger, headphones, camera, camera charger, e-reader |
| Documents and money | Wallet, ID, passport, tickets, booking confirmations, insurance details, driving licence, payment card, cash |
| Hygiene and personal care | Toothbrush, toothpaste, deodorant, shampoo, conditioner, soap, hairbrush, razor, skincare, sunscreen, lip balm, cosmetics, menstrual products, contact lenses, lens solution, glasses, personal medication, basic first-aid kit |
| Camping | Tent, sleeping bag, sleeping mat, headlamp, camping mug, utensils |

Most catalog items are optional until linked to a selected tag or enabled as baseline. Rental equipment can be excluded manually; rental management is later work. Document entries are reminders chosen by the user, not legal eligibility checks.

## Regeneration, edits and consistency

Generation persists a snapshot, not just a transient browser result. A fingerprint covers trip dates, active day tags, relevant library data and the algorithm version. Report a stale list when those inputs change; unrelated itinerary title/time edits should not force a recalculation.

Generate in a transaction after checking expected plan revision, library revision and current trip dates. Use a consistent lock order for operations that touch several aggregates (trip, profile, then plan) or an equivalent verified concurrency strategy. Library changes lock/bump the profile revision. Packing edits bump the plan revision. Return the committed snapshot. Drizzle supports transactional commit/rollback and PostgreSQL isolation options; adapt to the project's installed version and locking conventions. [Drizzle transactions](https://orm.drizzle.team/docs/transactions)

Reconcile by item ID. Preserve manual additions, manual quantity overrides, exclusions and packed counts on regeneration. If a new target is lower than packed count, cap the packed count to the effective target and make the changed quantity visible. If an item is no longer suggested but has manual edits or packing progress, retain it under Needs review; provide a remove action. Unmodified obsolete suggestions may disappear. Never rebuild the list by deleting every row and thereby lose the user's work.

The effective target is zero when excluded, otherwise the manual override if present, otherwise generated quantity. A null override means Follow suggestion; zero is a deliberate target and must not be treated as null. Clearing an override restores the current suggestion. Packed progress is the count of included checklist rows fully packed, with per-row quantity progress; do not mix number of rows and number of physical pieces in one percentage.

## API and implementation sequence

Proposed API capabilities: load/bootstrap personal library; create/update/archive categories, items and tags; replace tag-item links; load/create a trip plan; assign/remove day tags (including an atomic multi-day operation); generate/recalculate; update checklist entries and add manual items. Keep profile identity server-owned. Use typed inputs, expected revisions and existing structured errors. Queries should not create a plan implicitly; bootstrap and creation are explicit mutations.

1. **Establish final baseline.** Verify source completion, fork the final commit into the new worktree, inspect changed files and document base/ports. Preserve all existing work.
2. **Shell and data model.** Add Trips/Packing navigation, focused packing modules, owner-scoped schema and an additive migration. Scope itinerary-only viewport CSS to the Trips view. Do not redesign the itinerary again.
3. **Library and day tags.** Add idempotent template initialization, library editors, trip selector and date/tag assignment. Confirm refresh persistence and isolated identities before proceeding.
4. **Calculator and checklist.** Implement a pure server-side calculation module with worked-example tests, snapshot generation, explanations, overrides, manual additions and packed progress. Keep calculation independent of GraphQL and UI.
5. **Verify and hand over.** Run appropriate tests, lint, typecheck, builds, disposable PostgreSQL migration checks and browser interaction/visual checks. Document how to open the candidate and what remains deferred.

Likely new files: `apps/api/src/packing-domain.ts`, `packing-data.ts`, `packing-catalog.ts`, `apps/web/components/packing-workspace.tsx`, smaller library/checklist components, and `apps/web/lib/packing-client.ts`. API wiring and schema remain integrated with the existing application. Avoid another enormous all-in-one component.

Use a separate packing preview database and available ports; inspect existing processes before selecting them. Do not reuse or reset main's or the active redesign preview's data. The source preview currently uses web 3100, API 4100, database 55433, and its test container may use 55432. A candidate can use 3200/4200 and another available database port, but verify availability first. Do not run destructive test setup against an app database.

## Acceptance and validation matrix

| Scenario | Required evidence |
| --- | --- |
| Empty database, no trip | Packing shell and library work; useful create-trip link; no fabricated trip fixtures |
| Refresh after library/tag/checklist edit | PostgreSQL-backed state survives |
| Worked five-day example | Exact quantities above and traceable source explanations |
| One-day trip and midnight/DST/leap-day ranges | Correct inclusive days, zero one-day nights, no duplicated or shifted dates |
| Same item via two tags or baseline plus a tag | Union dates; no accidental multiplication |
| Traveler count greater than one | Personal quantities unchanged |
| Custom tag/item/category; rename and archive | Correct links and stable IDs; no lost saved-list progress |
| Regenerate twice; generate concurrently | Same suggestions; no duplicates or lost manual state; stale operation rejected |
| Item count override zero, reset override, exclusions | Null/zero behavior and explanations remain clear |
| Shrink/extend/delete trip | Stale handling, out-of-range review, appropriate plan cleanup; library preserved |
| Two profile identities | Reads and every mutation reject cross-profile identifiers; compound relations verified |
| Upgrade an existing database | Existing itinerary data survives; migration repeatable through the normal runner |
| Trips → Packing → Trips | Selected itinerary restored; calendar drag/resize and dialogs still operate |
| Narrow phone and desktop layouts | Readable day tags, no page overflow, usable quantities and library dialogs |
| Keyboard and screen-reader semantics | Accessible navigation, focus, tag removal, status announcements and dialogs |
| API failure during an edit | Retry available; no false saved state |

Run `pnpm check` on the candidate and `pnpm test:postgres` only with a disposable, verified test database. Browser checks should cover the full create-tag → assign-days → generate → pack → refresh → regenerate flow, not just a screenshot. No live AI call is needed for packing verification. Report failures and unperformed checks accurately.

## Follow-up and stopping condition

A scheduled follow-up on this task should check the source task every ten minutes. Stay quiet while it is still working or unchanged. Once completion is established, continue the authorized first-version implementation from its finished branch using this brief. Persist progress in a short implementation note so interrupted runs can resume the same worktree rather than create duplicates. Report completion, failure or a concrete question requiring the user. Pause the follow-up after delivery; do not create recurring feature work indefinitely.

Local scheduled work requires the computer to remain on and the desktop app running, as described in the [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations?surface=app).
