# TripDock

TripDock is a local-first trip planner for multi-stop journeys. This repository contains a complete local vertical slice: a responsive web app, a GraphQL Yoga API, PostgreSQL persistence through Drizzle, and server-side OpenAI Structured Outputs for editable new-trip drafts.

Canonical trip data lives only in PostgreSQL. The browser contains no trip fixtures, local-storage state, provider key, or AI mutation shortcut.

## What works

- Create, view, update, and delete trips.
- Add, edit, remove, and reorder destinations.
- Add, edit, and remove transport legs, stays, and activities.
- Generate an unpersisted trip draft from natural language, edit it, and explicitly create it.
- Reject stale manual edits with trip revision checks.
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

The API uses the OpenAI Responses API with strict Zod-backed Structured Outputs and `store: false`. The model extracts evidence-backed semantic intent; application code, rather than the model, resolves relative and locale-sensitive dates and validates the result. The key is read only by `apps/api`; it is never sent to or embedded in the web app. If either setting is missing, all manual functionality remains available and AI draft requests return a clear configuration error. There is no silent fixture fallback.

Run the separately billed, explicit provider smoke with:

```sh
pnpm test:ai-live
```

Run the versioned trip-creation quality corpus with:

```sh
pnpm test:ai-eval
pnpm test:ai-eval -- --suite regression
pnpm test:ai-eval -- --scenario dates.partial-endpoint-year --trials 3
```

The MVP corpus contains four semantic regression scenarios with one straightforward prompt each. All four block on failure, including deriving the trip end and stop intervals from a start date plus exact per-stop night counts. The evaluator scores extraction and resolved draft semantics with exact, app-owned assertions; it does not use an LLM judge or persist raw model responses.

Normal tests never call OpenAI. Their `FixtureAiGateway` is injected only by test code. Both live commands are explicit and potentially billed.

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
pnpm test:ai-eval    Run the versioned live trip-creation semantic eval corpus
```

## Architecture and trust boundary

```text
Browser (React/Vinext)
        │ GraphQL; accepted trip records and editable draft requests
        ▼
GraphQL Yoga API ───────────────► PostgreSQL 17
        │                          canonical trip data
        │ natural-language new-trip prompt
        ▼
OpenAI Responses API
        │ schema-validated intent and source evidence
        ▼
Deterministic resolver (locale, calendar rules, conflicts, field states)
        │ partial, unpersisted working draft + batched questions
        └────────► human confirm/edit + explicit Create ─► GraphQL Yoga API
```

The API owns validation, revision checks, entity ownership, and transaction boundaries. Model output is parsed through a strict intent schema, checked against quoted prompt evidence, and passed through deterministic date and minimum-viability rules. A creation draft needs at least one confirmed city plus valid start and end dates before it can be saved; traveler count is genuinely optional. Incomplete drafts still open in the normal create form with visible field states and all clarification questions together. The model cannot directly write accepted trip rows. Existing trips use manual CRUD only.

The active data model contains `trips`, `trip_stops`, `transport_legs`, `stays`, and `activities`. The immutable baseline migration also contains the legacy `ai_proposals` and `ai_proposal_operations` tables; they are retained only for migration compatibility and have no current GraphQL or application runtime path. UUID primary keys, foreign keys with cascades, ordered positions, timestamps, date/status checks, and trip revisions are defined in generated SQL migrations under `apps/api/drizzle`.

## Verification

`pnpm test` covers empty-database behavior, persistence across API instances, revision increments, destination-date linking, locale/year/weekend date resolution, city-level creation readiness, batched clarification transitions, protected manual edits, nullable travelers, the absence of existing-trip AI GraphQL fields, GraphQL error handling, and removal of production browser fixtures/storage. `pnpm test:postgres` is the optional real-PostgreSQL migration smoke. `pnpm check` is the required local gate.

The deterministic brand generator is `scripts/generate-brand-assets.py`. It requires Python 3 and Pillow (`python -m pip install Pillow`) and reproduces all checked-in icons and the social preview from `apps/web/public/brand/tripdock-logo.png`.

## Current limitations

- This is intentionally local-only: no deployment, authentication, authorization, collaboration, or multi-user concurrency beyond optimistic revision protection.
- Voice, WhatsApp, booking providers, uploads, background workers, notifications, and AI changes to existing trips are out of scope.
- Live model compatibility uses `pnpm test:ai-live`; trip-creation quality uses `pnpm test:ai-eval`. Deterministic tests do not spend API credits.
- Production hosting and infrastructure providers remain undecided.

The detailed slice contract is recorded in [docs/prototype-v0.md](docs/prototype-v0.md). The local-first/OpenAI boundary is recorded in [ADR 0001](docs/decisions/0001-local-first-development-with-live-openai.md).

## Repository policy

- Keep secrets out of Git; commit only sanitized examples.
- Make schema changes through reviewed generated migrations.
- Keep AI-created trip drafts editable and subject to deterministic server validation before persistence.
- Treat generated brand assets as reproducible derivatives of `apps/web/public/brand/tripdock-logo.png`.
