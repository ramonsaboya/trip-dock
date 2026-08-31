# TripDock

TripDock is a consumer-first web product for organizing multi-destination trips. It gives a group a structured view of destinations, transport, accommodation, activities, and the day-by-day plan. The current prototype starts with one trip owner, while collaborative coordination remains a core planned capability.

## Status

The project is currently in product, UX, and architecture design. `apps/web` contains an interactive, device-local UI prototype for evaluating the trips list and structured itinerary experience. It persists prototype trips, activity assignments, and reviewed proposals in browser storage, but it has no backend, shared persistence, authentication, GraphQL, live AI, or provider integrations yet.

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
- Activity assignment from a destination pool into the agenda, saved on the current device.
- A reviewed trip-essentials form that creates a real local draft.
- A deterministic review-before-apply proposal flow with selective changes and device-local persistence.
- Responsive layouts and keyboard-accessible modal interactions.

To run the prototype, install the pinned Node.js release with a user-owned version manager such as `fnm`, `nodenv`, `asdf`, or `nvm`. Then enable the pinned pnpm version with Corepack and run from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run dev
```

Use `pnpm run test` for the permission-free state-model tests, or `pnpm run check` for tests, lint, type checking, and the production build.

### macOS development

- `.node-version` and `.nvmrc` both pin Node.js 22.23.2; user-owned tools such as `fnm`, `nodenv`, `asdf`, and `nvm` can use them on Intel or Apple Silicon Macs. That release includes a Corepack version compatible with pnpm 11.
- Run `corepack enable` only after the selected Node version manager is active. This keeps Corepack's shims in a user-writable Node installation and avoids requiring administrator access.
- pnpm is pinned through the repository's `packageManager` field, so a global `sudo npm install` is neither needed nor recommended.
- Commands and scripts are shell-neutral and use repository-relative paths.
- Development preview automatically uses polling when Codex runs inside the macOS Seatbelt sandbox, avoiding unavailable FSEvents access.
- Set `TRIPDOCK_USE_POLLING=1` when working from a network volume or container-mounted folder that does not deliver file events reliably.
- Native packages in the frozen lockfile include macOS Intel and Apple Silicon variants. A clean install is still required on the target Mac before the first full preview.

The current prototype deliberately uses browser storage rather than pretending it is shared data. Clearing site data resets locally created trips and itinerary changes. PostgreSQL remains the accepted canonical store for the later application backend.

The exact prototype boundary and handoff notes are recorded in [Prototype v0](docs/prototype-v0.md).

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
