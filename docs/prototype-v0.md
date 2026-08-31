# TripDock local vertical slice

## Purpose

This slice replaces the original device-local prototype with the smallest honest end-to-end TripDock product loop. It runs entirely on the developer's machine apart from intentional, server-side OpenAI requests.

## Implemented flows

- A clean database returns an empty trip collection; the UI never inserts demo data.
- Manual forms persist trips, ordered stops, transport, stays, and activities through GraphQL.
- Every accepted edit increments a trip revision. Conflicting edits fail instead of overwriting newer data.
- Natural-language trip creation first produces an editable, unpersisted structured draft. Only the Create action persists it.
- Natural-language changes are stored as proposals and operations at the trip revision used to generate them.
- Preparing or viewing a proposal does not change accepted trip data.
- A person selects operation IDs and explicitly applies them. Selected operations, proposal state, and the trip revision change in one transaction; unselected operations are recorded as excluded.
- Manual edits make older pending proposals stale. Discarding a proposal never edits the trip.
- Closing a pending proposal keeps its persisted record available from the trip detail view.

## Persistence contract

PostgreSQL is canonical. The browser holds only transient interface state such as open dialogs, form values, the currently selected trip, and selected proposal-operation IDs. Reloading always queries GraphQL. There is no `localStorage`, seed dataset, Italy-specific renderer, keyword proposal, or timed mock response in production code.

The versioned Drizzle migration creates:

- `trips`
- `trip_stops`
- `transport_legs`
- `stays`
- `activities`
- `ai_proposals`
- `ai_proposal_operations`

Trips own a nonnegative revision. Child rows are ordered by explicit positions and cascade with their parent. Dates, traveler counts, statuses, positions, ownership, and references are validated by database constraints and/or transactional application logic.

## AI trust boundary

`OpenAiGateway` is the only production OpenAI path. It runs in the API process, submits minimal context, requests a strict Structured Output through the Responses API, sets `store: false`, and validates the result with Zod plus domain checks. Missing configuration, refusal, incomplete output, timeout, provider errors, and invalid output have explicit error codes.

Draft generation returns data without persisting it. Proposal generation may persist only the proposed operation record; it never invokes the accepted-data mutations itself. The deterministic `FixtureAiGateway` exists under the API's injected test path and is never a runtime fallback.

## Local security posture

- API and web servers bind to loopback addresses.
- CORS is limited to the configured web origin.
- GraphiQL is development-only.
- `OPENAI_API_KEY` is server-only and absent from all public environment names.
- Database reset refuses production mode, non-loopback hosts, and database names other than `tripdock` or `tripdock_test`.
- There is no authentication, so the slice is not suitable for shared or internet-accessible use.

## Verification contract

The deterministic gate is `pnpm check`. API tests exercise migrations in an isolated in-memory PostgreSQL-compatible harness, GraphQL persistence across application instances, revision semantics, proposals, selective apply, discard, staleness, and rollback. Web tests exercise GraphQL parsing, true empty collections, draft mapping, independent operation selection, arbitrary date presentation, and the absence of production fixtures or browser storage.

`pnpm test:postgres` applies the generated migration twice to the explicitly configured `tripdock_test` database. `pnpm test:ai-live` is separate, explicit, potentially billed, and requires both OpenAI settings.

## Deferred on purpose

- Authentication, authorization, sharing, and collaboration
- Voice, chat, WhatsApp, provider integrations, and uploads
- Background workers, notifications, and transactional outbox
- Remote environments, deployment, observability, backup, and production operations
- A broader AI operation vocabulary and model-quality evaluation suite
