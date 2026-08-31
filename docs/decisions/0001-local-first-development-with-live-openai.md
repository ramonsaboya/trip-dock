# ADR 0001: Local-first development with live OpenAI

- Status: Accepted
- Date: 2026-08-31

## Context

TripDock has no launch deadline that requires early investment in deployment infrastructure. The first complete product slice now runs locally with a web app, GraphQL API, and PostgreSQL.

The product does, however, need its real AI path during development. AI is expected to answer questions, turn natural-language or voice input into structured drafts, and prepare reviewable trip-change proposals. This creates one intentional external dependency even while the application, database, and supporting services remain local.

## Decision

This ADR accepts the environment and provider boundaries below. The local vertical slice implements these boundaries; later production architecture remains open.

### Local development is the default environment

The normal development workflow must not require AWS or another deployment platform. Application code, data, and supporting services will run locally when they are introduced. Production-provider selection and deployment work are deferred until TripDock needs a shared online environment, external testing, or production operations.

PostgreSQL is the canonical data store and runs locally through the pinned Compose service. Drizzle applies reviewed SQL migrations. Background jobs remain deferred.

AWS accounts, credentials, infrastructure-as-code, IAM, RDS, S3, SQS, SES, CloudWatch, LocalStack, and equivalent deployment work are out of scope for the current phase. The design should remain portable without accumulating speculative abstractions for a provider that has not been selected.

The Next.js, Vinext, Cloudflare, and OpenAI Sites tooling currently under `apps/web` is temporary prototype scaffolding. It is not a deployment-provider decision.

### OpenAI is the intentional external exception

Live OpenAI access is the intentional external dependency while the rest of TripDock runs locally:

- All OpenAI requests originate from server-side application code. Browsers and other clients never receive an OpenAI API key.
- Live AI is available during local development, while automated tests have a deterministic, non-networked provider.
- A model response never directly mutates canonical trip state. It produces an answer, structured draft, or reviewable proposal; deterministic application logic and explicit human approval control accepted changes.
- The application sends only the context needed for the request and excludes credentials, passport documents, unrelated traveler data, and raw voice recordings by default.

## Implemented slice profile

The following profile describes the implemented local slice and may be refined by later decisions.

### Local runtime

- Run the web application and API on the developer's machine.
- Run a pinned PostgreSQL container as the canonical data store.
- Define database state through reviewed schema migrations. Start clean; production runtime code has no seeds.
- Expose the application contract through GraphQL Yoga and keep the browser free of canonical data storage.
- Defer background processing, authentication, file storage, and email until a product flow requires them.

### AI adapter

- Place OpenAI access behind an application-owned `AiGateway`.
- Supply `OPENAI_API_KEY` through an ignored local environment file; a sanitized `.env.example` contains only the variable name and documentation.
- Select the provider explicitly. `OpenAiGateway` performs live calls, while `FixtureAiGateway` supplies deterministic tests and repeatable UI states. Do not silently fall back between them.
- Use the Responses API and JSON Schema Structured Outputs for structured drafts and change proposals.
- After every model response, validate schema and semantics, calculate conflicts and notification effects, check authorization and entity versions, persist a reviewable proposal, and apply only human-approved operations.
- Use `store: false` when TripDock owns the necessary conversation and proposal state. This avoids relying on OpenAI-managed response persistence but does not remove any separate abuse-monitoring retention that applies to the API account.
- Retain only operationally useful metadata such as the model identifier, prompt and schema versions, request identifier, token usage, timestamps, latency, and outcome. Do not log API keys, full prompts, full responses, or unredacted personal trip data.

The model and model snapshot remain configuration choices rather than domain logic. Select and pin them after workload-specific evaluation.

### Target developer contract

The repository should grow toward a small root-level command surface:

```text
pnpm db:up               # start the local PostgreSQL container
pnpm db:migrate          # apply reviewed migrations
pnpm dev                 # run the local web app and API
pnpm db:reset            # rebuild the explicitly local database, empty
pnpm test                # run deterministic tests without live provider calls
pnpm test:postgres       # exercise migrations against tripdock_test
pnpm test:ai-live        # run a small, explicit, billed OpenAI integration suite
```

Reset commands must refuse non-local database targets. Live AI tests must be separately named so normal test runs remain deterministic, fast, and inexpensive.

## Consequences

### Benefits

- Feature development is not blocked by cloud accounts, permissions, deployments, or shared resources.
- PostgreSQL behavior, migrations, authorization, proposals, and conflict handling can be tested with real local infrastructure.
- The real AI experience can be developed and evaluated from the beginning.
- Automated tests remain repeatable and do not incur accidental API usage.
- A future deployment provider can be selected from actual operational requirements.

### Costs and limitations

- Exercising live AI requires internet access, an OpenAI API project and key, and separate API billing.
- Fixture-based tests cannot establish model quality, latency, safety behavior, or current provider compatibility; the explicit live suite and product evaluations cover those risks.
- Local provider implementations do not prove future cloud configuration, permissions, quotas, networking, or delivery behavior.
- Deployment infrastructure remains future work rather than disappearing from scope permanently.

## Revisit when

Revisit this decision when any of the following becomes true:

- The team needs a shared remote development or demonstration environment.
- External users need access to an alpha or beta.
- A feature genuinely depends on cloud-specific behavior.
- Availability, backup, residency, observability, or recovery requirements can be stated concretely.
- Local development no longer represents the application's important behavior adequately.

## Not decided here

This decision does not select:

- The production hosting or cloud provider.
- The final web runtime or routing architecture.
- Whether GraphQL remains the long-term production API contract beyond this slice.
- A production authentication, storage, email, queue, or observability provider.
- The final background-job implementation.
- A specific OpenAI model or snapshot.

## References

- [OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication)
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
