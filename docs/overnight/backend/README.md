# Backend review pack

TripDock should keep its TypeScript/Yoga/Drizzle/PostgreSQL architecture. The useful change is a clearer separation between transport, application commands, deterministic policy and provider interpretation, with stronger transaction read semantics. This branch implements that change without changing the GraphQL schema or trip-creation rules.

Read these in order:

1. [Baseline map](01-baseline.md): responsibilities, data and control flows, current strengths, concrete problems and scope boundaries.
2. [Research](02-research.md): current primary-source guidance, applicability to the installed stack, alternatives and limits of the evidence.
3. [Target and decisions](03-target-and-decisions.md): architecture, prioritized work, tradeoffs, feasibility and rollback.
4. [Implementation and verification](04-implementation-and-verification.md): exact changes, before/after evidence, test results, integration instructions and morning decisions.

Review baseline: `f80de19f32b39b2b77b940a480fabf4d6cebcd62`. Branch: `codex/backend-architecture-review`. Source review and documentation access: 11 September 2026. The review is scoped to `apps/api` and this folder; other tasks own frontend, visual design and root contributor guidance.

The required workspace gate passed: **185 tests passed, one optional PostgreSQL test skipped**, plus lint, typechecks and both builds. The explicit PostgreSQL suite also passed against a separate PostgreSQL 17.6 container, including migration upgrades, concurrent revisions and deliberately interleaved reads/writes. No deployment, live billed AI call, shared database reset, application model change or web change is part of this branch.

The most useful morning action is to review and integrate the backend commits, then combine the frontend/design work and rerun the gate. Product decisions about stricter trip-creation readiness remain outside this architecture refactor. Local origin protection and basic operational diagnostics are follow-up work described in the plan, not claims of production readiness.
