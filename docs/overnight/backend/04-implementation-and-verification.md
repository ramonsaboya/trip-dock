# Implementation and verification report

## Implemented outcome

The backend now exposes clear places for GraphQL contracts, application commands, validation, deterministic policy, trip reads and transaction coordination. It retains PostgreSQL as the canonical store and preserves all external GraphQL fields and input contracts. AI drafts remain unpersisted and editable; explicit creation still validates them server-side.

Five functional corrections accompany the decomposition: collection reads no longer multiply per trip; trip queries use consistent snapshots; mutations return their own changed view; resequencing handles gaps left by deleted stops; and unexpected errors remain masked even under `NODE_ENV=development`. Packing shares expected-error conversion and no longer overlaps read statements on a single transaction client.

## File changes and before/after evidence

| Area | Before (`f80de19`) | After |
| --- | --- | --- |
| GraphQL composition | 1,038-line mixed module | 33-line [composition root](../../../apps/api/src/graphql.ts), 228-line SDL, 35-line resolver adapter, 26-line shared error adapter; itinerary services 77/185/156 lines. |
| Deterministic trip creation | 2,066-line mixed module | Stable four-line barrel plus schemas (211), calendar (337), evidence (613), assembly (914) and provider orchestration service (20). |
| Public base SDL | Embedded in `graphql.ts` | Identical extracted string; SHA-256 `b0b073ae710c4831bd369881f69b87f9e72765e782b60e5ee3410314880afb4e`. Packing SDL untouched. |
| Trip-creation logic | 76 top-level declarations | All 76 preserve their TypeScript tokens after excluding export visibility, comments and formatting; existing semantic tests pass. |
| List hydration SELECTs | `1 + 5 × trip count`; 16 for three trips | Five for a nonempty list; one for empty. GraphQL snapshot BEGIN/COMMIT are additional control statements. |
| Trip query consistency | Parent/children read through separate statement snapshots | Read-only Repeatable Read around each trip query. A committed writer between the first SELECT and child reads cannot produce mixed data. |
| Mutation response | Pool hydration after commit | Hydration inside the command transaction; a later committed writer cannot replace the first response's name/revision. |
| Destination positions | Temporary offset used surviving row count | Offset uses maximum existing position plus one. Baseline SQL reproduced PostgreSQL `23505` for positions `[0,2]`; updated middle-stop deletion returns/stores `[0,1]`. |
| Unexpected errors | Yoga could expose original detail in development | `maskedErrors: { isDev: false }`, tested against private injected error text under development. |

No source/module-size count is presented as a quality score. The material change is which responsibility owns the code. The assembler and evidence module remain sizeable because their policy is substantial, and further product-driven decomposition is still possible.

## Verification environment and results

Verification used Windows PowerShell, **Node 24.21.0** and **pnpm 11.19.0**. The repository pins Node 22.23.2; that exact runtime was not used, so compatibility on it remains a follow-up. Dependencies were installed from the existing frozen lockfile; there are no package/lockfile edits.

| Check | Result |
| --- | --- |
| Initial `pnpm install --frozen-lockfile --offline` | Cache unavailable in the sandbox; no dependency change. Host-access frozen installation then succeeded using the existing store. |
| Initial sandboxed `pnpm check` | Environment failure before tests: `uv_os_get_passwd`/`ENOMEM` from tsx on Windows. Host-access retry succeeded. |
| Baseline `pnpm check` | Exit 0. API 81 passed/1 optional skipped, web 101 passed; lint, typechecks and both builds passed. |
| API gate during decomposition | Exit 0. Original API tests passed after extraction and transaction changes. |
| Final `pnpm check` | Exit 0. **API 84 passed/1 optional skipped; web 101 passed; total 185 passed, zero failed.** Lint, typechecks and both builds passed. |
| Explicit `pnpm test:postgres` | Exit 0. One encompassing integration test passed, zero skipped, against isolated PostgreSQL 17.6. Includes all migrations twice, existing-row upgrades, packing, itinerary, new concurrency and snapshot scenarios. |
| Baseline position defect probe | Reproduced unique violation `23505` using the old offset in a synthetic transaction, then rolled back. |
| SDL/declaration comparison | Exact SDL hash above; all 76 deterministic declarations preserved. Migration/dependency/web diff checks empty. |
| Final whitespace/diff review | `git diff --check` clean; reviewed new modules, changed transaction/read paths, error handling and scope. |

The build retains a Vinext route-classification notice also present in the baseline; it is not a backend regression. During the first real PostgreSQL pass, pg warned about overlapping client queries. Sequential hydration/library reads removed that warning, and the final PostgreSQL pass was clean. Intermediate missing-import/test-type errors introduced during extraction were corrected before the final gate.

Raw local command logs remain in ignored `test-results/backend/` (`baseline-check.log`, `final-check.log`, `postgres-check.log`). They are not required to run the committed regressions. The result table records their final outcomes so the report remains usable after integration.

## What the added tests establish

- [API integration regressions](../../../apps/api/tests/api.integration.test.ts) verify that an empty collection performs one SELECT, three trips perform five, children remain with their owner, and a private error is opaque in development.
- [Backend transaction scenarios](../../../apps/api/tests/backend-scenarios.ts) verify deletion of a middle destination, actual stored positions, rollback after inserting an invalid interval, and exactly one winner for two writes with the same expected revision. The concurrent branch runs only on real PostgreSQL, with a four-connection pool.
- [PostgreSQL read scenarios](../../../apps/api/tests/postgres-read-scenarios.ts) interleave a real committed writer after the query's parent SELECT. The response retains old trip/stop dates consistently while a subsequent DB read sees the new dates. A second scenario inserts another committed edit immediately after the first transaction completes and verifies that the first service response retains its own name/revision.
- The existing suite continues to verify arbitrary trip data, manual CRUD, revision errors, linked boundary changes, external endpoints, packing ownership/overrides, semantic extraction/date rules, and voice provider isolation with injected requests.

These tests do not establish live model quality, microphone behavior, frontend visual quality, a production performance envelope or multi-user authorization. No live smoke/eval command or real provider request was run. No browser runtime fixture or local-storage persistence was added.

## Isolated PostgreSQL target

The review used only a newly created container named `tripdock-backend-review-bdf3`, labeled `tripdock.purpose=backend-review-bdf3`, running the repository's `postgres:17.6-alpine`. Docker allocated loopback port **59613**. The fixed port initially attempted was occupied, so the new never-started container was replaced with one using dynamic allocation; no existing container was stopped or altered.

The explicit test environment was:

```powershell
$env:TEST_DATABASE_URL='postgresql://tripdock:tripdock@127.0.0.1:59613/tripdock_test'
pnpm test:postgres
```

These are synthetic local test credentials. The runner rebuilds `public`/`drizzle` schemas only in its explicitly selected `tripdock_test`; this assignment never ran it against an existing/shared database. For another run, create or inspect a dedicated target first and substitute its actual port. The review container is stopped after verification and retained with its synthetic data. The original checkout's untracked MVP review was neither overwritten nor removed.

## Commit and integration notes

Baseline is `f80de19f32b39b2b77b940a480fabf4d6cebcd62`; branch is `codex/backend-architecture-review`. Implementation, tests and scoped rules are in `5c067e1` (`refactor(api): separate domain services and make trip reads consistent`), followed by the review-pack commit. Both hashes are included in the final task handoff and can be obtained with `git log --oneline f80de19..codex/backend-architecture-review`.

Integrate the series onto the combined review branch, preserving both the implementation and documentation. No migration or dependency installation beyond the existing frozen lockfile is required by the changes. Root contributor rules remain owned by the frontend task. If another branch changed backend operations, move those changes into the corresponding service/schema files rather than restoring the large old modules. Run `pnpm check` after integration and the PostgreSQL gate against a disposable database when reconciling transaction code.

Rollback is a Git revert of the backend implementation commit, followed by the deterministic gate. No database rollback is needed because schemas, migrations and stored shapes did not change. Reverting also loses the position/read-consistency/error-masking fixes. For a narrow issue, prefer reverting the specific behavior while retaining the extracted modules and tests, documenting the guarantee temporarily relinquished. This branch is committed locally only; it has not been merged, pushed or deployed.

## Morning attention

There is no blocking routine architecture question. Review the explicit correctness changes and integrate if accepted. The remaining meaningful decisions are whether to prioritize the local hardening/operational slices next, and whether a separately specified product slice should tighten destination readiness. A shared pilot still requires explicit authorization and identity/ownership/spend/backup design; this branch does not start that work.

The two practical validation limits are the untested pinned Node 22 runtime and the absence of live provider/microphone checks. The operational plan also calls out the old PostgreSQL minor pin and the still-minimal diagnostics. These are recorded limits, not failures hidden behind the green deterministic gate.
