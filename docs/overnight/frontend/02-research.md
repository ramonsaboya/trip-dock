# Frontend architecture research

## Scope and evidence

The architecture question is how a small local-first trip planner can become understandable and safe to change without losing working behavior. The relevant constraints are the current React/Vinext implementation, PostgreSQL authority, editable AI drafts, manual revision-checked itinerary edits and a small contributor group. Recommendations below separate official framework guidance from judgments about this repository.

Sources were reviewed on 11 September 2026. The lockfile pins React 19.2.8, Next 16.3.3, Vinext 1.0.0-beta.8, Vite 8.2.2 and TypeScript 5.9.3. React's current documentation displayed v19.3 during review. The recommendations use established component, state, effect and subscription APIs already present in the pinned code; they do not require a React upgrade. Current Next documentation describes Next behavior, while TripDock executes through Vinext. Compatibility claims must therefore be checked against the installed runtime and actual build rather than inferred from a Next example.

The evidence supports local decomposition and stronger behavior tests. It does not demonstrate a need for a new router, global store, form framework, state-machine library, generated client, CSS-in-JS runtime or deployment provider.

## Component boundaries and feature organization

React explains component state in terms of component identity and position in the rendered tree. Removing a component or changing its identity resets that state; keeping its position preserves it. This is directly relevant to extracting TripDock's mounted creation forms and keyed trip views.[^1]

**Judgment for TripDock:** the safest first boundaries are already named responsibilities: trip creation, each entity editor, calendar, packing, dialog, field and date picker. Moving a named component into a file does not require changing its props, key or position. A shared component should own a real responsibility, such as consistent label/error association, rather than exist only to reduce JSX line count.

Feature folders are a repository convention, not a React requirement. Here they reduce search and merge scope because calendar work, packing work and trip-creation work are independently meaningful. One component per file is an explicit maintenance preference and is now enforced by a structural test. Tiny pure helpers can remain with their owner; a separate file for every constant would create navigation overhead without a corresponding boundary.

The resulting cost is more files and imports. That cost is worthwhile when the file names answer contributor questions directly. The important result is that a stay editor change no longer requires opening a 102 KB application module containing unrelated microphone and date-picker behavior.

## State ownership and derived values

React recommends grouping related state, avoiding contradictory states, avoiding duplicated or redundant values and keeping state structures manageable. Values that can be calculated from props or existing state generally should not become additional state.[^2]

**Judgment for TripDock:** the accepted collection, selected navigation ID, unsaved draft and editor form are different kinds of state with different owners. A draft is intentionally a copy because the person is editing it before acceptance. A second mutable selected-trip object would be accidental duplication. The current derived selection from ID plus collection is appropriate.

The refactor keeps minimum readiness, omitted destinations, filtered questions and packing progress derived. It keeps the discriminated entity-editor union instead of separate booleans for five modals. Replacing all local state with context would obscure who is allowed to update a draft or accepted record. A feature-local reducer remains an option when transitions become difficult to reason about, rather than a prerequisite for tidy files.

React describes reducers as a way to centralize related update logic spread across many handlers.[^3] Creation has enough coordinated state to make a reducer plausible. The lower-risk improvement here is first extracting pure follow-up reconciliation, which is the most intricate transition. A later reducer can reuse that tested function rather than reimplement destination identity and manual protection while also changing the component tree.

## Effects and bounded hooks

React treats effects as synchronization with external systems and requires cleanup corresponding to setup. Its documentation covers development StrictMode's additional setup/cleanup cycle and the need to prevent outdated fetch responses from changing current state.[^4] Its custom-hook guidance favors concrete use cases over generic lifecycle wrappers.[^5]

**Judgment for TripDock:** collection loading is a concrete hook boundary. It accepts no form or navigation state and returns only accepted collection state, replacement/removal actions and retry. Initial load and retry should share cancellation behavior. The extracted request lifetime checks abort status before publishing either success or error, including a fetch implementation that resolves after cancellation.

Mutation initiation stays in user event handlers. Follow-up generation, trip creation and entity saves are not effects triggered by changing form fields. That distinction keeps typing and dictation from accidentally making provider requests or saving data.

The existing modal, microphone, animation, hash subscription and calendar frame effects have genuine external systems to synchronize. They should not be merged into an application lifecycle hook. Cleanup belongs near the subscription or resource it releases. The creation animation remains in its overview owner because it depends on that component's DOM measurements and retained layout.

React's guidance on avoiding unnecessary effects also recommends handling event-specific logic in the relevant event handler and calculating render-derived values directly.[^6] That supports the current separation rather than a broad rewrite of all effects into hooks.

## Server data and async libraries

The current application performs one initial trip collection query and receives complete accepted trip records from mutations. Packing has a separate data lifecycle. There is no demonstrated need for cross-route query deduplication, offline reconciliation, background polling or shared remote-cache invalidation across many independently mounted consumers.

**Judgment:** keep a small application-owned data boundary for this scope. A query-cache library is a credible alternative if repeated fetching and invalidation become a recurring source of defects. A global UI store would not solve that same problem. These alternatives should be evaluated against concrete request duplication or consistency failures rather than installed preemptively.

The tradeoff is explicit responsibility for request cancellation, loading/error states and accepted-record replacement. The new collection tests exercise these responsibilities directly. The hook does not pretend to be a reusable cache: it has no cache key registry, persistence adapter, optimistic reconciliation engine or invalidation protocol.

A query-library documentation page could not be retrieved reliably during this review, so no version-specific defaults or cache behavior are asserted here. That gap does not block the decision: the repository evidence does not yet establish a requirement for that dependency. Revisit with official versioned documentation if a specific caching requirement appears.

## GraphQL and TypeScript boundaries

GraphQL responses can contain `data`, `errors` and `extensions`; some field failures can return partial data alongside errors. Network failures are a separate class from GraphQL execution errors.[^7] The browser's transport already distinguishes network, HTTP, GraphQL and absent-data failures, and preserves server error details.

**Judgment:** retain the existing policy of rejecting a response containing GraphQL errors rather than silently accepting partial mutations. Keep transport handling in one module, query documents in another and pure date/draft functions outside both. The operation strings and field selection should remain unchanged through an architectural refactor.

TypeScript modules provide explicit import/export boundaries, including type-only imports.[^8] Type annotations on `graphqlRequest<T>` are nevertheless a compile-time expectation, not runtime verification of received JSON. That limitation existed before extraction and remains documented. The server's validated contract and deterministic API tests are important complementary checks.

Generating a typed GraphQL client would reduce manually maintained wire types, but would add a generation workflow shared with the backend. It becomes compelling if schema changes are frequent enough that manual types drift. Today the narrower change is to isolate `types.ts` and `operations.ts`, make their ownership obvious and preserve revision arguments in each editor. Backend integration should compare these files explicitly.

## Server versus client rendering

Next's documentation separates server-rendered work from client components that need state, effects, event handlers and browser APIs. A client boundary also brings its imported component subtree into the client-side application.[^9] Vinext describes itself as a Vite implementation of the Next API surface and documents its RSC/Cloudflare plugin integration.[^10]

**Judgment:** preserve the current route/runtime while separating frontend responsibilities. The application is highly interactive, and moving a component to another file does not by itself make it server-rendered or reduce downloaded JavaScript. No bundle-size or hydration-speed claim follows from this refactor.

Server-side trip fetching is a possible future architectural choice, but it would change request origins, credentials/environment assumptions and refresh behavior. It should be considered alongside the backend and deployment decision, not smuggled into a maintainability change. The current local-only API and established browser GraphQL flow remain understandable and testable.

The pinned Vinext beta and combined build plugins warrant caution about assuming exact Next behavior. The production build is part of verification; the browser harness separately verifies client composition. Neither one alone proves production hydration, and the report states that boundary explicitly.

## Existing calendar performance mechanisms

React's external-store API requires a stable immutable snapshot when the underlying data has not changed, and subscription identity affects whether React resubscribes.[^11] That is relevant to the calendar's selective feedback model and hash navigation subscription.

**Judgment:** preserve the calendar's existing indexed event preparation, prepared destination paper, cell-level feedback subscriptions and horizontal windowing. These mechanisms address demonstrated calendar work, documented in the repository's earlier performance review. A top-level global store or a new calendar package would threaten those gains without answering the current maintainability question.

Extracting `CalendarCell`, `CalendarPool`, `DurationHandle` and memoized `HourPaper` gives their contracts names and files while keeping subscription semantics. The large calendar renderer remains the main residual frontend concentration. Further extraction should follow visual/interaction responsibilities and retain tests for window pinning, half-hour snapping, drag offset and cancellation. Lines alone are a poor reason to replace its data model.

## CSS ownership and tokens

CSS custom properties centralize reusable values and participate in inheritance and the cascade.[^12] Next documents that stylesheet import ordering affects ordering in production and recommends checking production output rather than assuming development order is sufficient.[^13]

**Judgment:** existing semantic tokens are the correct foundation for TripDock. The immediate architecture pass should preserve selector names, declarations and import order because another task owns deliberate visual changes. Moving CSS between imports during component extraction would mix cascade changes with behavior changes and make regressions harder to attribute.

The next style step is a documented owner map and small, ordered feature sections or files. Keep foundational tokens and shared control styles central; colocate new feature-specific rules where the contributor naturally starts. CSS Modules are an option for new isolated components, but converting all established selectors would make the design task's work harder and erase straightforward before/after evidence.

A global string catalogue has a similar tradeoff. Keep human-facing labels beside their view, centralize genuinely shared status vocabulary, and treat API enum values and question payloads as structured data. Introduce translation infrastructure when translation is an actual product requirement.

## Testing and accessibility contracts

Testing Library's principles prioritize tests that resemble real use rather than internal component instances.[^14] Playwright recommends testing visible behavior with isolated tests and user-facing locators; its network tools can fulfill API requests without calling the real endpoint.[^15][^16]

**Judgment:** retain existing pure helper/API assertions, expand the old source checks to cover extracted modules, and add a small browser suite for composition. The important paths are retained manual edits, draft review before persistence, follow-up protection, explicit save, accepted revision handling, reload and failure/retry. Test data belongs only in test files, and the browser build must never import it.

A mocked GraphQL browser harness cannot prove PostgreSQL persistence, provider quality or the actual Vinext server. Those need separate verification. Its value is precisely that it can exercise user controls repeatedly without billing AI or writing into a person's real trip database. The same harness can replay against the original source for visual comparison.

The WAI-ARIA modal pattern describes focus movement into the dialog, contained Tab traversal, Escape dismissal and return of focus to the invoking element when appropriate.[^17] The existing date picker additionally handles nested Escape and keyboard calendar movement. Extracting shared controls must preserve these behaviors; it does not establish full WCAG conformance. Explicit dialog focus return and narrow-viewport navigation remain targeted design follow-ups.

## Recommendation

Keep the current runtime and API boundary. Organize by real feature responsibilities, put one component definition in each file, isolate pure trip/draft logic, and use a narrowly named request hook for accepted records. Preserve existing CSS and performance mechanisms while adding observable browser-flow evidence. Revisit a reducer, query cache, generated client or CSS migration only when its specific maintenance benefit can be demonstrated.

This direction makes parallel maintenance safer without distributing one controller across an arbitrary number of files. A contributor editing a transport form still sees its conversion and revision rules together. A contributor changing date semantics can exercise pure functions without mounting the UI. A designer can find the component and stylesheet that own a visible control.

## Sources

All sources below are primary project documentation. Access date: 11 September 2026; living documentation generally does not provide a stable publication date. Version applicability is stated above.

[^1]: React. [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state).
[^2]: React. [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure).
[^3]: React. [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer).
[^4]: React. [useEffect](https://react.dev/reference/react/useEffect).
[^5]: React. [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).
[^6]: React. [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
[^7]: GraphQL Foundation. [Response](https://graphql.org/learn/response/).
[^8]: Microsoft TypeScript. [Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html).
[^9]: Vercel/Next.js. [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
[^10]: Cloudflare/Vinext. [Official repository and usage documentation](https://github.com/cloudflare/vinext).
[^11]: React. [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore).
[^12]: MDN. [Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties).
[^13]: Vercel/Next.js. [CSS](https://nextjs.org/docs/app/getting-started/css).
[^14]: Testing Library. [Guiding Principles](https://testing-library.com/docs/guiding-principles/).
[^15]: Microsoft Playwright. [Best Practices](https://playwright.dev/docs/best-practices).
[^16]: Microsoft Playwright. [Mock APIs](https://playwright.dev/docs/mock).
[^17]: W3C WAI-ARIA APG. [Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
