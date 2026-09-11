# Follow-up product decisions — 11 September 2026

These decisions supersede the future-scope recommendations in the overnight design review. They intentionally keep the current product small; they are not forgotten features or an instruction to implement the deferred flows.

## Destinations are fixed after creation

Destination names and destination date ranges should be fixed once a trip is created. Do not add destination-management controls, including add/remove/reorder, or expose a standalone destination editor for saved trips. Manual and AI-assisted creation drafts remain editable before explicit creation.

The earlier recommendation to add destination management inside Edit trip is deferred, not approved for implementation. If revisited, it should be designed as a whole-trip editing flow under **Edit trip**, with explicit review of the effects on the existing itinerary.

Before enabling structural changes, decide and test:

- What happens to scheduled activities when a destination's dates move, shrink or disappear? Do dates remain absolute, move with the destination, return to the idea pool, or require user resolution?
- What happens to activities and stays assigned to a replaced or removed destination, including booked items and entries outside the new date range?
- How are transport endpoints and times reconciled when destinations change or reorder?
- How do day-based packing assignments and generated lists respond to changed trip dates?
- How does the user preview affected records, resolve conflicts and explicitly accept the complete change? The server must validate the resulting trip and reject stale revisions.

Do not silently shift or delete dependent records to make an edit fit. Existing activity, stay and transport editing is not being redesigned by this decision.

The implementation scope for overall trip-date editing is being clarified separately: the existing Edit trip dialog exposes overall dates as well as the trip name. This distinction matters because changing overall dates can affect the same dependent records. Do not claim that the current UI enforces a complete date freeze until the corresponding controls have been addressed.

### Current enforcement

Calendar destination headings are now text, with no edit action or saved-destination editor mounted by TripDetail. Creation fields stay editable. This is a product-UI restriction, not a new backend immutability guarantee: existing stop mutation contracts and the unused StopEditor module remain for separate coordinated consideration. Overall trip dates remain as before pending the scope clarification above.

## Accessibility: revisit as a whole

Defer the calendar keyboard-navigation redesign to a broader accessibility review. Include calendar Tab-stop count and windowing, focus order and visibility, keyboard and single-pointer alternatives to gestures, screen-reader announcements, date pickers, dialogs, text enlargement, contrast and target spacing. Preserve existing accessibility behavior and the focus fixes already completed; this deferral does not justify regressions.

## Mobile agenda: defer

Keep the improved responsive calendar for now. Revisit whether an agenda view is needed after observing the current mobile workflow. No separate agenda view is approved in this follow-up.

## Additional validation: defer deliberately

Physical-device and assistive-technology checks, production hydration, and the incomplete native delete/cancel check remain documented validation work for a later pass. Live AI/dictation quality testing still requires separate authorization for billed calls. These limitations must remain visible in the handoff; do not describe the current verification as covering them.

## Ownership and integration

Keep this follow-up on the isolated design branch. Frontend and backend tasks were checked and were idle in their separate worktrees at the start of this follow-up. Do not edit their checkouts or introduce backend schema/contract changes as part of the UI decision. Include the resulting commit and any remaining enforcement gap in the integration handoff.

## Verification of the destination-only follow-up

`pnpm check` passed: 108 web tests, 81 API tests, one optional PostgreSQL test skipped, lint, typechecks and both builds. All seven browser flows passed, including 320/390/768 px checks that the destination label remains visible and has no edit button. The 390 px browser-harness screenshot was visually inspected. See [gate output](follow-up-check.txt) and [browser output](follow-up-browser-tests.txt). This follow-up used the available Node 24.21.0 runtime; pinned Node 22.23.2 verification remains outstanding. No database or live provider calls were needed for this UI restriction.
