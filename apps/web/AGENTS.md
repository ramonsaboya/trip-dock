# Frontend working guide

Read the [file map](../../docs/overnight/frontend/01-baseline-map.md) and [decisions](../../docs/overnight/frontend/03-target-and-decisions.md) before structural changes.

## Where work belongs

- `app/page.tsx` and `app/layout.tsx`: route entry, metadata and global CSS order.
- `components/trip-dock-app.tsx`: application composition, navigation and notices.
- `features/trips`: overview, accepted collection loading, shared trip fields, creation and entity editors.
- `features/calendar`: itinerary rendering, cells, resize controls and paper. Preserve indexed preparation, selective subscriptions and windowing in `lib/trip-calendar.ts`, `calendar-interactions.ts` and `calendar-window.ts`.
- `features/packing`: plan, checklist and personal library views. `lib/packing-client.ts` owns its API/data helpers.
- `components/ui`: shared dialog, label/status field, date picker and logo. Dictation and theme controls remain in `components`.
- `lib/graphql/request.ts`: HTTP/GraphQL envelope errors and abort propagation.
- `lib/trips`: wire types, operation strings, date conversions, stop linking, draft readiness/merge and destination alignment. `lib/graphql-client.ts` is a compatibility facade for existing consumers; new production code imports the focused owner.

## Editing contracts

One top-level React component definition per file; named exports and kebab-case filenames. Do not define components inside other components. Keep helpers with their owner until a distinct responsibility or actual reuse warrants a separate module. Avoid generic controller hooks and schema-driven editor frameworks.

Data modules must not import UI or tests. Share explicit props and callbacks; keep draft/form state in its mounted owner. Accepted trip records come only from GraphQL responses. Use full returned records and expected revisions. An editable draft is not an accepted trip cache.

Effects synchronize external systems and clean up subscriptions, frames, timers and requests. Use request cancellation plus a late-completion guard. Event-triggered mutations belong in event handlers. Preserve mounted manual/AI forms while the overview changes modes; retain stable draft stop IDs and dirty-path remapping.

Keep CSS selectors and the `globals.css` → `packing.css` / `theme.css` cascade stable during structural refactors. New feature styles should have a clear owner and reuse existing semantic tokens. Deliberate visual changes need desktop and narrow-viewport review in both themes.

Preserve associated labels, error descriptions, keyboard date navigation, nested Escape behavior, live status/error roles, focus restoration and inert inactive panels. Do not trade these away for fewer lines.

## Verification

Run `pnpm check` from the repository root. For UI changes run `pnpm --filter @tripdock/web test:browser`; it mounts actual components under StrictMode using a test-only Vite entry and intercepted GraphQL. It does not validate real PostgreSQL or Vinext hydration. Installed Chrome is the default browser channel; configure another available Playwright channel deliberately for other machines.

Unit tests use Node's built-in runner and `.ts` import extensions for directly executed pure modules. Prefer behavior tests for interactions; source checks enforce architecture/trust boundaries only. Keep existing assertions when moving their source targets. Production must never import `tests` or use its fixtures. For reproducible file metrics run `node apps/web/scripts/architecture-metrics.mjs [git-ref]` from the root.
