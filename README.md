# TripDock

TripDock is a consumer-first web product for organizing multi-destination trips. It gives a group a structured view of destinations, transport, accommodation, activities, and the day-by-day plan. The current prototype starts with one trip owner, while collaborative coordination remains a core planned capability.

## Status

The project is currently in product, UX, and architecture design. `apps/web` contains an interactive, mock-data-only UI prototype for evaluating the trips list and structured itinerary experience. It has no backend, persistence, authentication, GraphQL, AI, or provider integrations yet.

## Important future investigation: shared project memory and coordination

> [!IMPORTANT]
> TripDock needs a deliberate, repository-based way to keep project ideas, direction, decisions, active work, ownership, and handoffs discoverable and current for both people and AI agents. Before multiple developers and agents work in parallel, investigate the best file structure and maintenance workflow for this shared “team brain.”
>
> That investigation must also define how branches and worktrees are used together, including task isolation, ownership, naming, synchronization, handoff, integration, and cleanup. The goal is to make the project’s current intent easy to recover on any machine, reduce duplicated or overlapping work and merge conflicts, and help humans and AI coordinate without relying on private chat history or one person’s memory.
>
> This is a future design task only. Do not build or select the system or branch workflow as part of the initial repository setup.

## UI prototype

The prototype currently demonstrates:

- A simple upcoming-trips list with route previews and realistic planning states.
- A multi-destination Italy itinerary with first-class transport between stops.
- Expandable destination sections for accommodation, activity ideas, and daily plans.
- Mock activity assignment from a destination pool into the agenda.
- Natural-language trip intake and a persisted-looking review-before-apply AI proposal flow.
- Responsive layouts and keyboard-accessible modal interactions.

To run the prototype, install Node.js 22.13 or newer and pnpm, then run:

```sh
cd apps/web
pnpm install --frozen-lockfile
pnpm run dev
```

Use `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build` for the current automated checks.

## Product direction

- Create a trip from a short form or from natural-language text or audio.
- Represent destinations as ordered stops connected by explicit transport legs.
- Track accommodation separately from activities.
- Maintain an activity pool for each destination and assign activities to days.
- Let AI answer questions and prepare persisted, reviewable change proposals.
- Require explicit human approval before an AI proposal changes the accepted trip.
- Support WhatsApp as an additional conversational surface, starting with secure one-to-one trip linking.

## Current technical direction

The accepted workflow boundaries are:

- PostgreSQL as the canonical data store.
- A local-first development environment with no AWS account, credentials, infrastructure, or emulation required in the current phase.
- Live OpenAI API access from the local server for natural-language and voice intelligence, with deterministic fixtures for automated tests.
- Production-provider selection for hosting, compute, storage, queues, authentication, observability, and email is deferred. Those capabilities use local implementations during development when introduced.

The accepted local-development and AI boundary is recorded in [ADR 0001](docs/decisions/0001-local-first-development-with-live-openai.md).

The following application-stack candidates are not approved decisions:

- React, Vite, React Router, and Relay for the production web application.
- TypeScript, Fastify, GraphQL Yoga, and Pothos for a custom GraphQL modular monolith.

The current `apps/web` prototype uses Next.js, Vinext, and Cloudflare/OpenAI Sites development tooling. That scaffold supports prototype preview and does not select a production web runtime or deployment provider.

## Repository policy

- Keep secrets out of Git and provide sanitized `.env.example` files when configuration is introduced.
- Record consequential product and architecture choices as short decision documents.
- Treat generated artifacts as derived outputs and verify them from their source definitions.
- Keep AI-generated changes reviewable and subject to the same tests and validation as human-authored changes.
