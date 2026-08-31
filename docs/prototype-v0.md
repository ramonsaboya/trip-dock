# TripDock prototype v0

## Purpose

This slice turns the existing visual concept into a usable, permission-free product loop. It is intentionally a browser prototype rather than an early production backend.

## Working flows

- View every seeded trip and its route outline.
- Create a trip from reviewed essentials, including editable ordered destinations.
- Reopen locally created trips after a refresh.
- Assign Rome activity ideas to the day-by-day plan and retain the assignment.
- Prepare a deterministic proposal, keep or discard it, select individual operations, and apply only the selected operations.
- Retain accepted itinerary changes when a later proposal is prepared or discarded.

## Local state contract

The browser stores a versioned `PrototypeState` under `tripdock.prototype.v1`. Restore logic validates the shape, removes unknown activity and proposal identifiers, clears interrupted loading states, and falls back to deterministic seed data when the stored value is invalid.

This storage is device-local and disposable. It is not the canonical data model promised by the product direction, does not synchronize between browsers, and must not become an implicit replacement for PostgreSQL.

## AI boundary

The current proposal is a deterministic fixture. It exercises the important trust boundary—proposed operations remain separate from accepted trip state until explicit approval—without an API key, network call, or paid model request. A later server-owned `AiGateway` can replace the fixture without changing that approval rule.

## Deferred on purpose

- PostgreSQL schema, migrations, API, and background worker.
- Authentication, authorization, collaboration, and notifications.
- Live OpenAI and voice input.
- WhatsApp, booking providers, accommodation search, and uploads.
- Production runtime and hosting decisions.
- The repository “team brain” and worktree workflow investigation called out in the main README.

## macOS contract

The repository pins Node.js 22.23.2 and pnpm 11.19.0, uses LF and case-consistent imports, keeps command bodies shell-neutral, and includes macOS Intel and Apple Silicon native packages in the frozen lockfile. The pinned Node release includes a Corepack version that understands pnpm 11's executable layout. Vite polls for file changes automatically inside the Codex Seatbelt sandbox, with an explicit polling override for network or mounted filesystems.

On macOS, activate the pinned Node release through a user-owned version manager before running `corepack enable`; this keeps the generated shims writable without administrator access. The next machine-level step is a clean frozen dependency install, followed by `pnpm check` and a Safari/WebKit smoke pass on a Mac.
