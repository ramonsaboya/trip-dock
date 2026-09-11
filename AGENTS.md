# TripDock contributor rules

TripDock is a small local-first trip planner. Start with [README](README.md), then the relevant app's guidance. Current frontend map and decisions are in [docs/overnight/frontend](docs/overnight/frontend/README.md). Product notes can be historical; verify claims against code and the latest explicit requirements.

- PostgreSQL owns canonical trips and packing data. Browser state is transient; do not add runtime trip fixtures or browser-storage persistence. Theme preference storage is intentional.
- AI trip drafts remain editable and unpersisted until explicit creation, with deterministic server validation. Existing-trip edits use manual GraphQL mutations and revision checks.
- Keep durable provider credentials server-only. Dictation uses an API-issued short-lived credential; never embed the server key in the web bundle.
- Preserve migrations and unrelated/untracked work. Do not reset databases, deploy, or run billed AI commands without specific authorization. Use isolated test data.
- Do not expand local development into authentication, multi-user features, or hosting selection incidentally.

Navigation: `apps/web` owns React/Vinext UI and browser helpers; `apps/api` owns GraphQL, domain validation, Drizzle and AI adapters; `docs/decisions` records architectural decisions; `scripts` contains local launchers and verification tools.

Use pinned Node/pnpm versions from README. `pnpm check` runs deterministic tests, lint, typechecks and builds. `pnpm --filter @tripdock/web test:browser` runs isolated UI flows (Chrome required). `pnpm test:postgres` is a separate configured test-database check. `test:ai-live` and `test:ai-eval` incur provider usage and are never substitutes for the deterministic gate.

Keep changes scoped and reviewable. Coordinate ownership before editing overlapping files; finish a coherent branch and report its commit for integration. Update the relevant file map or contract when ownership changes. Do not introduce dependencies or abstractions without identifying the concrete problem they solve.
