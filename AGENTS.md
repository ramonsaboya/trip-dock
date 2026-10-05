# TripDock contributor rules

TripDock is a small local-first trip planner. Start with [README](README.md), then the relevant app's guidance. Current frontend map and decisions are in [docs/overnight/frontend](docs/overnight/frontend/README.md). Product notes can be historical; verify claims against code and the latest explicit requirements.

- PostgreSQL owns canonical trips and packing data. Browser state is transient; do not add runtime trip fixtures or browser-storage persistence. Theme preference storage is intentional.
- AI trip drafts remain editable and unpersisted until explicit creation, with deterministic server validation. Existing-trip edits use manual GraphQL mutations and revision checks.
- Keep durable provider credentials server-only. Dictation uses an API-issued short-lived credential; never embed the server key in the web bundle.
- Preserve migrations and unrelated/untracked work. Do not reset databases, deploy, or run billed AI commands without specific authorization. Use isolated test data.
- Do not expand local development into authentication, multi-user features, or hosting selection incidentally.

Navigation: `apps/web` owns React/Vinext UI and browser helpers; `apps/api` owns GraphQL, domain validation, Drizzle and AI adapters; `docs/decisions` records architectural decisions; `scripts` contains local launchers and verification tools.

Use pinned Node/pnpm versions from README. `pnpm check` runs deterministic tests, lint, typechecks and builds. `pnpm --filter @tripdock/web test:browser` runs isolated UI flows (Chrome required). `pnpm test:postgres` is a separate configured test-database check. `test:ai-live` and `test:ai-eval` incur provider usage and are never substitutes for the deterministic gate.

## Owner's implementation and release workflow

- During implementation and iteration, make the requested changes directly. Do not write tests or run tests, lint, typechecks, builds, browser verification, or other verification commands unless the owner explicitly requests them. A tiny targeted check is allowed only when necessary to unblock implementation; explain it. Report what changed and what remains unverified. Never claim correctness or passing checks without evidence. The owner manually tests and requests iterations.
- When the owner says "this is done", "do all the tests and checking", or explicitly requests final verification, enter the release phase: add meaningful missing behavioral regression tests, run `pnpm check`, the browser suite for UI changes, and isolated PostgreSQL checks for database/transaction changes. Fix failures and repeat affected checks until they pass. Ask for input only when a product decision or owner retest is needed. Billed AI commands still require separate specific authorization.
- Only after owner acceptance and successful final verification, commit and push the intended changes to `main`. Use another branch when the owner explicitly requests experimental work or a named branch. Preserve unrelated files and commits; reconcile remote changes without force pushing. Do not interpret implementation completion as owner acceptance.
- CI verifies pushes and pull requests. A successful push to `main` automatically deploys that exact commit to the existing DigitalOcean installation. This is standing authorization for this pipeline; infrastructure changes outside that installation, database resets, and billed AI commands still require specific authorization.
- These phase rules also govern verification instructions in app-level guides and the README. Setting up this workflow is itself an implementation task: wait for owner acceptance before final local checks, committing, and pushing.

Keep changes scoped and reviewable. Coordinate ownership before editing overlapping files. Update the relevant file map or contract when ownership changes. Do not introduce dependencies or abstractions without identifying the concrete problem they solve.
