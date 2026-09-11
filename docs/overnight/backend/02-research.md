# Backend architecture research

## Scope and evidence

The relevant question is how a small, local-first TypeScript application can remain easy for several humans and agents to change safely. The implementation already uses GraphQL Yoga 5.22.0, GraphQL 17.0.2, Drizzle 0.45.2, pg 8.23.0, Zod 4.5.4 and OpenAI SDK 7.8.0. PostgreSQL is pinned to 17.6 in Compose. Recommendations below concern those boundaries; they do not assume that a newly published major version or a framework migration is necessary.

Official documentation was accessed on 11 September 2026. Most pages are living documentation without a stable publication date. PostgreSQL references deliberately use version 17, Yoga pages use v5, and recommendations involving library calls were also checked against the installed types and local tests. Search results and historical product notes were not treated as sufficient evidence of runtime behavior. No billed model evaluation, external security test or production benchmark was performed.

Each section separates what documentation establishes from an engineering choice for TripDock. Public sources cannot decide the product's preferred destination-readiness rule, release audience or acceptable AI spend; those depend on product intent.

## 1. Modular GraphQL without an application framework migration

**Evidence.** Yoga accepts a GraphQL schema composed from type definitions and resolver maps. Its schema documentation does not require a dependency-injection container, decorator framework, repository class hierarchy or federated graph. That supports keeping the existing transport and composing feature-owned modules in ordinary TypeScript. [Yoga: GraphQL Schema](https://the-guild.dev/graphql/yoga-server/docs/features/schema)[^1].

**Judgment.** The problem in the baseline is not Yoga. It is that one file handles both the public contract and transaction policy. An SDL module, a small adapter and application command factories expose useful boundaries without changing deployment or introducing new dependencies. Factories take the existing database handle; production and tests can construct the same service directly.

Alternatives include leaving the monolith intact, splitting only the SDL, creating one generic CRUD repository per table, or adopting GraphQL Modules/Nest. Splitting only the SDL helps scrolling but leaves policy coupled to resolver arguments. Generic CRUD obscures trip-level revision locking and date propagation. A framework adds its own lifecycle and vocabulary to a product that already has explicit composition. The chosen feature/service arrangement is an incremental organizational choice, not a claim that all small applications need formal layered architecture.

Keep external API changes separate from file movement. Changes to nullability, field names, error codes, deprecated mutations or input defaults carry client implications. In this branch, the base SDL is identical and the packing SDL is untouched; there is no frontend regeneration or coordination dependency.

## 2. Types, runtime schemas and semantic validation have different jobs

**Evidence.** TypeScript's `strict` flag enables a family of stronger static checks. Zod's `parse` validates data and throws on failure; `safeParse` provides a discriminated success/error result. These address different phases: compilation of known code versus validation of values received at runtime. [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html)[^2], [Zod: Basic usage](https://zod.dev/basics)[^3].

**Judgment.** TripDock should retain GraphQL document validation, Zod request validation, pure semantic policies and SQL constraints. Removing Zod because GraphQL is typed would lose bounds, UUID validation and date/ownership semantics. Moving every rule to SQL would make interactive draft feedback harder and cannot express all cross-row policies safely. Conversely, duplicating parsers in each resolver creates inconsistent errors for identical problems.

The existing `domain.parseInput` is enough reusable infrastructure. Service input schemas remain close to commands, while provider extraction schemas stay with trip creation. No schema-generation library is needed for the present scope. A stronger compile-time mapping of schema/resolver names may be useful if the graph grows, but it should solve an observed mismatch rather than create generated files for their own sake.

## 3. Atomic writes are not the same as a consistent response

**Evidence.** PostgreSQL Read Committed takes a new snapshot per statement, so successive reads can see commits from another transaction. Read-only Repeatable Read provides a stable snapshot across those reads. Read-only transactions at that level do not incur the write serialization failures that applications must handle when using stronger isolation for updates. [PostgreSQL 17: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html)[^4].

**Judgment.** TripDock loads a parent row and four child collections. A trip revision is useful only when the returned child data belongs to the same database snapshot. The proportional fix is a short read-only repeatable-read transaction around each trip query. It does not require serializable isolation for every operation, automatic conflict retries, a global mutex or a cached aggregate.

Mutation responses have a related issue: if the command commits and then rereads through the pool, another edit can change the result before the first response is assembled. Reading the changed view while the parent lock is held ensures the response describes that command's result. Drizzle only resolves the transaction promise after commit, so this does not send uncommitted success to the client. The tradeoff is four child reads while holding the lock; for a small itinerary this is preferable to a misleading revision response.

The choice does not promise a single snapshot across every unrelated field in a GraphQL document. Each trip query resolver owns its snapshot. Packing queries still have separate read semantics and are identified as follow-up work. The regression tests deliberately commit a writer between parent and child reads to verify the guarantee actually implemented.

## 4. Keep explicit parent locking and one transaction client

**Evidence.** PostgreSQL row locks block conflicting writers/lockers until the transaction ends. At Read Committed, `SELECT FOR UPDATE` can wait for a concurrent writer and then return the updated row. Consistent lock order reduces deadlock risk. Drizzle exposes transactions and isolation/access-mode configuration; node-postgres requires transaction statements to use the same client rather than arbitrary pool queries. [PostgreSQL 17: Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)[^5], [Drizzle: Transactions](https://orm.drizzle.team/docs/transactions)[^6], [node-postgres: Transactions](https://node-postgres.com/features/transactions)[^7].

**Judgment.** The existing parent-trip lock and `expectedRevision` check fit an aggregate whose children change together. Keep them. A single compare-and-swap UPDATE can protect a simple scalar write, but replacing the current protocol piecemeal would complicate multi-row date propagation and packing lock order. Blindly retrying a revision conflict could overwrite a newer user's intent; the correct response remains refresh and retry deliberately.

Statements inside a transaction now execute sequentially during hydration. `Promise.all` does not create independent database sessions when all queries share `tx`. The installed pg version emitted a warning about overlapping queries on one client during real verification; sequential reads removed it without enabling pipelining or changing dependencies. This is direct local runtime evidence, not a performance claim about every driver/version.

## 5. Batch a known read shape before adding a cache or DataLoader

**Evidence.** Drizzle offers SQL-like querying and a relational query API; its documentation explains that relational querying can fetch nested data as one SQL query. SQL-like querying remains available for explicit joins, filters and projections. [Drizzle: Query Data](https://orm.drizzle.team/docs/data-querying)[^8].

**Judgment.** TripDock's `trips` resolver already returns full hydrated records, so its repeated reads are visible in one function. Baseline cost is one ID-list SELECT plus five SELECTs per trip. Loading parent rows once and each child table once changes this to five SELECTs for any nonempty collection. For three trips the count is 16 → 5, excluding transaction control statements. A counting regression also verifies that children stay attached to the correct trip.

A request-scoped DataLoader would make more sense if independently executed nested resolvers repeatedly requested the same entities. A global cache would add invalidation obligations to canonical data. A complex multi-join query risks row multiplication across several one-to-many collections; the five-query shape is easy to read and test. Drizzle relational querying is a viable alternative, but adopting it would also require relation definitions and careful version-specific review. Neither alternative provides enough additional value for this change.

The collection is still unpaginated and hydrated even if the client selects only IDs. Five queries is not bounded memory or a proof of low latency at large scale. Pagination/projections should follow an actual history-size or response-size problem, before the IN-list/row volume becomes large. No production latency claim follows from query-count arithmetic.

## 6. Constraints and migration history are part of the design

**Evidence.** PostgreSQL unique constraints enforce uniqueness and create supporting indexes; composite foreign keys can bind related identity columns together. Cross-row assumptions should not be encoded as ordinary CHECK constraints. Drizzle supports migration workflows in which generated SQL is applied and tracked. [PostgreSQL 17: Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)[^9], [Drizzle: Migrations](https://orm.drizzle.team/docs/migrations)[^10].

**Judgment.** Retain TripDock's composite stop/trip FKs and unique positions. They make ownership mistakes visible even if an application path misses a check. Keep trip chronology/minimum-stop policy in transactional commands. Do not rewrite legacy AI tables out of migration history merely because the current feature no longer uses them.

The position-offset fix is a concrete consequence of immediate uniqueness: after a deletion, a row count is not necessarily larger than every occupied position. Temporarily moving rows above the maximum existing position avoids collision before assigning dense positions. No new migration or deferrable constraint is needed. Existing redundant-looking indexes can be reviewed later with real query plans; deleting them is not required to make the code maintainable.

Migration verification should include an old populated schema, not only a fresh empty one. The existing explicit suite already checks preservation of transport and activity rows while applying later migrations; the branch preserves and runs that test. The test target must be disposable because that runner rebuilds its schemas.

## 7. Structured AI output is evidence to interpret, not accepted state

**Evidence.** OpenAI documents structured outputs, explicit refusal handling and the possibility that schema-conforming outputs still contain mistakes. The Responses format solves output shape, not the correctness of every extracted fact. [OpenAI: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)[^11].

**Judgment.** TripDock's strongest AI design choice is the separation of extraction from deterministic interpretation and explicit creation. Preserve it. The model can identify a phrase as a date intent; the application owns reference dates, weekend conventions, ambiguity, city resolution and validation before storage. Splitting schemas, calendar rules, evidence checks and draft assembly clarifies those responsibilities without changing the prompt, schema identifier, model or user flow.

A single broad natural-language parser, a second model judge or an agent framework would add failure modes before there is evidence of benefit. Keep a small versioned corpus for extraction/resolution semantics and add cases for distinct product changes. A deterministic fixture cannot establish live model compatibility or quality. The live corpus was not run under this assignment's no-billed-calls constraint.

**Evidence.** OpenAI distinguishes application-state storage from abuse-monitoring retention and documents endpoint-specific data controls. `store: false` is not a blanket guarantee that every form of provider retention disappears. [OpenAI: Data controls](https://developers.openai.com/api/docs/guides/your-data)[^12].

**Judgment.** Keep `store: false`, server-only credentials and minimal prompt context. Retain sanitized operational metadata only when it has a defined debugging purpose. Do not log prompts or full provider responses merely to make a dashboard more detailed. The current gateway returns model/response identifiers internally, but the GraphQL draft flow does not retain a full operational record; that remains a small observability design task.

## 8. Dictation credentials have a narrower boundary than ordinary API keys

**Evidence.** The Realtime client-secret reference defines expiration as the window for creating sessions; a session may continue after it starts, and the secret can create multiple sessions while valid. A short credential lifetime is therefore not the same as a server-enforced audio-duration or billing cap. [OpenAI: Create client secret](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)[^13].

**Judgment.** Keep the durable key on the API server and the direct browser WebRTC flow. The existing 60-second credential lifetime, bounded credential requests and browser session cap are sensible local controls, but do not market them as account authorization or a hard provider spend ceiling. No dictation model migration or delay change is justified by an architecture review. A later robustness slice can validate credential response types and byte decoding and test disconnect/timeout behavior more exhaustively.

## 9. Safe errors and CORS are separate concerns

**Evidence.** Yoga masks unexpected errors, exposes deliberate `GraphQLError` messages/extensions, and can include original error details in development unless `maskedErrors.isDev` is disabled. Its CORS and CSRF guidance distinguish preflight behavior from simple browser requests that can avoid preflight. [Yoga: Error Masking](https://the-guild.dev/graphql/yoga-server/docs/features/error-masking)[^14], [Yoga: CORS](https://the-guild.dev/graphql/yoga-server/docs/features/cors)[^15], [Yoga: CSRF Prevention](https://the-guild.dev/graphql/yoga-server/docs/features/csrf-prevention)[^16].

**Judgment.** Keep one conversion path for expected application/validation failures and force opaque unexpected errors even during development. The new regression injects a private error under `NODE_ENV=development` and asserts that neither message nor stack reaches the response. Packing's duplicate-name mapping remains feature-specific, rather than globally translating every uniqueness failure into a name conflict.

Exact CORS response headers should not be described as authentication. A useful local hardening slice would explicitly define allowed browser Origins, preserve intended CLI/GraphiQL access, reject inappropriate request formats and test that rejected requests do not call a resolver/provider. This needs no multi-user expansion. Authentication, per-trip user authorization and broader abuse protection belong to a separately approved shared-pilot milestone.

## 10. Test where the guarantee exists; add small operational controls first

**Evidence.** Yoga documents in-process HTTP testing through its request/fetch surface. pg-mem describes itself as an in-memory emulator with limitations, not a complete PostgreSQL substitute. Those tools support different claims. [Yoga: Testing](https://the-guild.dev/graphql/yoga-server/docs/features/testing)[^17], [pg-mem repository](https://github.com/oguimbal/pg-mem)[^18].

**Judgment.** Use fast pure tests for calendar/evidence/packing policies, Yoga requests for the actual public contract, and real PostgreSQL for lock/rollback/constraint/isolation behavior. The new real tests force particular interleavings rather than assuming concurrency from two sequential requests. Keep live provider evaluation separate. Avoid adding a browser or LLM test to prove an internal function was moved unchanged; structural comparison plus the existing semantic suite is more relevant.

**Evidence.** node-postgres exposes connection deadlines, pool error events and explicit pool shutdown. Node's HTTP server close operation finishes asynchronously; completion has a callback/promise boundary. Yoga supports configurable logging. [node-postgres: Pool](https://node-postgres.com/apis/pool)[^19], [Node HTTP: server.close](https://nodejs.org/api/http.html#serverclosecallback)[^20], [Yoga: Logging and Debugging](https://the-guild.dev/graphql/yoga-server/docs/features/logging-and-debugging)[^21].

**Judgment.** Before adopting distributed tracing, implement a small safe event sink, operation duration/outcome, an idle-pool error handler, and HTTP drain before closing the DB pool. Tests should show recovery after a simulated database interruption and shutdown with an in-flight request. A raw-error logger would undo the privacy discipline; explicitly enumerate safe metadata. No telemetry dependency or hosting provider is required for these improvements.

PostgreSQL's version policy recommends current minor releases; the source lists 17.11 while this repo pins 17.6. A minor upgrade merits a reviewed maintenance task with a backup and smoke test, not an unrequested container/volume change during a refactor. PostgreSQL 17 remains supported; a major-version migration is not implied. [PostgreSQL: Versioning Policy](https://www.postgresql.org/support/versioning/)[^22].

## Source inventory

All sources above were accessed on 11 September 2026. Publishers and applicability: The Guild (Yoga v5 schema, error, CORS/CSRF, testing and logging documentation); Drizzle Team (querying, transaction and migration documentation, checked against installed 0.45.2 types); PostgreSQL Global Development Group (version 17 concurrency/constraints and current support policy); node-postgres maintainers (transaction/client/pool APIs); Microsoft (TypeScript strict configuration); Zod maintainers (runtime validation); OpenAI (structured output, retention and Realtime credentials); pg-mem maintainer repository (emulator scope); Node.js project (HTTP lifecycle).

The linked page adjacent to each claim is the primary source used. Current documentation may include features newer than installed dependencies; no dependency update was made on the strength of documentation alone. Local behavior, exact version pins and final verification results are recorded separately in the implementation report.

## Sources

[^1]: The Guild. [Yoga: GraphQL Schema](https://the-guild.dev/graphql/yoga-server/docs/features/schema). Living documentation/repository; accessed 11 September 2026.
[^2]: Microsoft. [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html). Living documentation/repository; accessed 11 September 2026.
[^3]: Zod maintainers. [Zod: Basic usage](https://zod.dev/basics). Living documentation/repository; accessed 11 September 2026.
[^4]: PostgreSQL Global Development Group. [PostgreSQL 17: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html). Living documentation/repository; accessed 11 September 2026.
[^5]: PostgreSQL Global Development Group. [PostgreSQL 17: Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html). Living documentation/repository; accessed 11 September 2026.
[^6]: Drizzle Team. [Drizzle: Transactions](https://orm.drizzle.team/docs/transactions). Living documentation/repository; accessed 11 September 2026.
[^7]: node-postgres maintainers. [node-postgres: Transactions](https://node-postgres.com/features/transactions). Living documentation/repository; accessed 11 September 2026.
[^8]: Drizzle Team. [Drizzle: Query Data](https://orm.drizzle.team/docs/data-querying). Living documentation/repository; accessed 11 September 2026.
[^9]: PostgreSQL Global Development Group. [PostgreSQL 17: Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html). Living documentation/repository; accessed 11 September 2026.
[^10]: Drizzle Team. [Drizzle: Migrations](https://orm.drizzle.team/docs/migrations). Living documentation/repository; accessed 11 September 2026.
[^11]: OpenAI. [OpenAI: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Living documentation/repository; accessed 11 September 2026.
[^12]: OpenAI. [OpenAI: Data controls](https://developers.openai.com/api/docs/guides/your-data). Living documentation/repository; accessed 11 September 2026.
[^13]: OpenAI. [OpenAI: Create client secret](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create). Living documentation/repository; accessed 11 September 2026.
[^14]: The Guild. [Yoga: Error Masking](https://the-guild.dev/graphql/yoga-server/docs/features/error-masking). Living documentation/repository; accessed 11 September 2026.
[^15]: The Guild. [Yoga: CORS](https://the-guild.dev/graphql/yoga-server/docs/features/cors). Living documentation/repository; accessed 11 September 2026.
[^16]: The Guild. [Yoga: CSRF Prevention](https://the-guild.dev/graphql/yoga-server/docs/features/csrf-prevention). Living documentation/repository; accessed 11 September 2026.
[^17]: The Guild. [Yoga: Testing](https://the-guild.dev/graphql/yoga-server/docs/features/testing). Living documentation/repository; accessed 11 September 2026.
[^18]: Olivier Guimbal and pg-mem contributors. [pg-mem repository](https://github.com/oguimbal/pg-mem). Living documentation/repository; accessed 11 September 2026.
[^19]: node-postgres maintainers. [node-postgres: Pool](https://node-postgres.com/apis/pool). Living documentation/repository; accessed 11 September 2026.
[^20]: Node.js project. [Node HTTP: server.close](https://nodejs.org/api/http.html#serverclosecallback). Living documentation/repository; accessed 11 September 2026.
[^21]: The Guild. [Yoga: Logging and Debugging](https://the-guild.dev/graphql/yoga-server/docs/features/logging-and-debugging). Living documentation/repository; accessed 11 September 2026.
[^22]: PostgreSQL Global Development Group. [PostgreSQL: Versioning Policy](https://www.postgresql.org/support/versioning/). Living documentation/repository; accessed 11 September 2026.
