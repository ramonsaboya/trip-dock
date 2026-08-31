# TripDock

TripDock is a local-first trip planner for multi-stop journeys. This repository contains a complete local vertical slice: a responsive web app, a GraphQL Yoga API, PostgreSQL persistence through Drizzle, and server-side OpenAI Structured Outputs for draft generation and reviewable change proposals.

Canonical trip data lives only in PostgreSQL. The browser contains no trip fixtures, local-storage state, provider key, or AI mutation shortcut.

## What works

- Create, view, update, and delete trips.
- Add, edit, remove, and reorder destinations.
- Add, edit, and remove transport legs, stays, and activities.
- Generate an unpersisted trip draft from natural language, edit it, and explicitly create it.
- Prepare and persist an AI proposal without changing accepted trip data.
- Select individual proposal operations, apply them in one transaction, keep a proposal for later, or discard it.
- Reject stale edits and proposals with trip revision checks.
- Start from a genuinely empty database with polished loading, error, and empty UI states.
- Use the supplied TripDock logo throughout the header, favicon, Apple icon, PWA icons, manifest, and social preview.

## Local setup

Prerequisites:

- Node.js 22.23.2 (pinned in `.node-version` and `.nvmrc`)
- pnpm 11.19.0 through Corepack
- Docker with Compose for the local PostgreSQL container

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open [http://localhost:3000](http://localhost:3000). The GraphQL endpoint is [http://127.0.0.1:4000/graphql](http://127.0.0.1:4000/graphql); GraphiQL is enabled only in development. Both servers bind locally, and the API permits the exact `WEB_ORIGIN` configured in `.env`.

The Compose service initializes two empty databases on a fresh volume:

- `tripdock` for the application
- `tripdock_test` for the optional real-PostgreSQL integration smoke

No seed command or runtime fixture is provided. `pnpm db:reset` is intentionally destructive, refuses non-local hosts and unknown database names, and recreates an empty migrated schema.

## Live OpenAI configuration

Set both server-only values in the ignored root `.env`:

```dotenv
OPENAI_API_KEY=your-project-key
OPENAI_MODEL=your-structured-outputs-capable-model
```

The API uses the OpenAI Responses API with strict Zod-backed Structured Outputs and `store: false`. The key is read only by `apps/api`; it is never sent to or embedded in the web app. If either setting is missing, all manual functionality remains available and AI mutations return a clear configuration error. There is no silent fixture fallback.

Run the separately billed, explicit provider smoke with:

```sh
pnpm test:ai-live
```

Normal tests never call OpenAI. Their `FixtureAiGateway` is injected only by test code.

## Commands

```text
pnpm dev             Run the API and web app in watch mode
pnpm build           Build both applications
pnpm check           Run deterministic tests, lint, typecheck, and builds
pnpm db:up           Start local PostgreSQL
pnpm db:down         Stop local services without deleting the volume
pnpm db:generate     Generate a reviewed Drizzle SQL migration
pnpm db:migrate      Apply pending migrations
pnpm db:reset        Empty and remigrate an explicitly local database
pnpm test:postgres   Test migrations against TEST_DATABASE_URL
pnpm test:ai-live    Make one explicit live OpenAI Structured Outputs request
```

## Architecture and trust boundary

```text
Browser (React/Vinext)
        │ GraphQL; accepted records and proposal selections
        ▼
GraphQL Yoga API ───────────────► PostgreSQL 17
        │                          canonical trips + proposals
        │ minimal trip context
        ▼
OpenAI Responses API
        │ schema-validated draft or proposed operations
        └────────► persisted proposal ──human selection──► one DB transaction
```

The API owns validation, revision checks, entity ownership, proposal status, and transaction boundaries. Model output is parsed through a discriminated Zod operation schema and then validated against the current trip. It cannot directly write accepted trip rows. The initial AI operation vocabulary is deliberately small: update trip essentials, add an activity, update an activity, and remove an activity. Manual CRUD covers the full implemented data model.

The migrated schema contains `trips`, `trip_stops`, `transport_legs`, `stays`, `activities`, `ai_proposals`, and `ai_proposal_operations`. UUID primary keys, foreign keys with cascades, ordered positions, timestamps, date/status checks, and trip revisions are defined in the generated SQL migration under `apps/api/drizzle`.

## Verification

`pnpm test` covers empty-database behavior, persistence across API instances, revision increments, proposal persistence, selective application, staleness, discard behavior, rollback, deterministic AI fixtures, GraphQL error handling, and removal of production browser fixtures/storage. `pnpm test:postgres` is the optional real-PostgreSQL migration smoke. `pnpm check` is the required local gate.

The deterministic brand generator is `scripts/generate-brand-assets.py`. It requires Python 3 and Pillow (`python -m pip install Pillow`) and reproduces all checked-in icons and the social preview from `apps/web/public/brand/tripdock-logo.png`.

## Current limitations

- This is intentionally local-only: no deployment, authentication, authorization, collaboration, or multi-user concurrency beyond optimistic revision protection.
- Voice, WhatsApp, booking providers, uploads, background workers, notifications, and itinerary chat are out of scope.
- Live model quality and compatibility require `pnpm test:ai-live`; deterministic tests do not spend API credits.
- Production hosting and infrastructure providers remain undecided.

The detailed slice contract is recorded in [docs/prototype-v0.md](docs/prototype-v0.md). The local-first/OpenAI boundary is recorded in [ADR 0001](docs/decisions/0001-local-first-development-with-live-openai.md).

## Repository policy

- Keep secrets out of Git; commit only sanitized examples.
- Make schema changes through reviewed generated migrations.
- Keep AI output reviewable and subject to the same deterministic validation as human input.
- Treat generated brand assets as reproducible derivatives of `apps/web/public/brand/tripdock-logo.png`.
