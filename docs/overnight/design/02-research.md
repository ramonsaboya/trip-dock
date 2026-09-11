# Design research and applicability

## Scope and evidence quality

This review uses primary W3C accessibility materials and the GOV.UK Design System. Sources were accessed on 11 September 2026. WCAG 2.2 is the relevant published recommendation used here; its Understanding documents explain criteria but are informative, and APG supplies implementation patterns rather than a conformance guarantee. GOV.UK guidance reflects extensive public-service practice, but its transaction-heavy context is not identical to a personal itinerary planner. Apply interaction principles without importing its branding, page-per-question structure or component package.

The research question is narrow: which reversible changes materially improve this small planner's actual journeys while preserving current behavior? No evidence here supports adding a design-system dependency, replacing the framework, adopting an AI-first home screen, or building a separate mobile application. Those are architecture/product bets beyond the observed defects.

## Reflow and the two-dimensional calendar

WCAG 1.4.10 expects content to remain usable at 320 CSS pixels for vertically scrolling content, with exceptions where two-dimensional layout is necessary for meaning. W3C explicitly distinguishes the excepted table from surrounding content. A calendar can preserve horizontal movement while its heading, actions, instructions and forms reflow. The exception does not justify squeezing every other control alongside the grid.[^1]

**Application judgment:** fix the calendar's narrow-width layout first. Keep a readable day width and let the calendar scroll horizontally; give the idea pool a full-width bounded row. Retain the desktop sidebar where it fits. A separate agenda view could eventually improve small-screen efficiency, but doubles presentation and interaction paths, needs its own scheduling semantics, and is not necessary to correct the current regression.

**Complication:** viewport-locked calendars and stacked content can compete for height. The chosen implementation must keep both surfaces reachable, consider short landscape windows, and avoid merely hiding the pool. Use actual browser measurements at 320/390 px and a desktop viewport, with full-page and viewport captures.

## Targets, density and pointer alternatives

WCAG 2.5.8 establishes a 24 × 24 CSS pixel target minimum, subject to spacing and other exceptions. This is not the same as a universal 44 px AA requirement. Larger controls remain useful for frequent mobile actions, while densely repeated controls need context-sensitive spacing.[^2] WCAG 2.5.7 requires an alternative to dragging with a single pointer where dragging is not essential. Keyboard support is a separate concern; a keyboard shortcut alone is not that pointer alternative.[^3]

**Application judgment:** preserve the calendar's click-to-edit schedule and packing's tag-then-day assignment. Make their availability explicit in concise copy. Do not enlarge every half-hour cell into a giant button. Evaluate destructive corner buttons, date picker navigation and grouped destination actions with their actual neighboring geometry. Keep larger touch targets for primary actions and named alternatives to resize gestures.

**Alternative rejected:** remove all dragging to simplify accessibility. This would discard established behavior that can be efficient for pointer users. The correct tradeoff is equivalent non-drag control, tested independently, without requiring every interaction style to look identical.

## Focus visibility and navigation cost

WCAG 2.4.11 requires keyboard-focused controls not to be entirely obscured by author-created content. Sticky headers and footers are common causes; scroll padding is one documented mitigation. W3C distinguishes the AA minimum from the stronger goal of keeping the whole focused item visible.[^4]

**Application judgment:** native focus rings and a focusable calendar region are useful foundations, but a clipped container can hide them. Keep controls inside visible widths and inspect focus after opening, saving and cancelling. The 120 baseline hourly Tab stops are a real efficiency concern. A future roving calendar-cell pattern should be designed with virtualization and visible-day preservation together, rather than hastily applying `role="grid"` to a complex table and implying keyboard behavior it does not implement.

The APG tabs pattern specifies one active tab in the Tab sequence, arrow navigation between tabs, appropriate selected/controls relationships, and activation behavior suited to latency.[^5] TripDock already implements Schedule/Packing semantics and arrow handling. Preserve that implementation and verify it after extraction instead of replacing tabs with unlabeled icon navigation.

## Dialogs and irreversible actions

APG recommends moving focus into a modal, containing its Tab sequence, supporting Escape, and restoring focus to the invoking control where appropriate. Initial focus should suit the content; a least-destructive action is appropriate for difficult-to-reverse operations.[^6] W3C's HTML dialog technique describes native modal behavior that reduces the need to recreate inertness and focus confinement manually.[^7]

**Application judgment:** retain the existing native `<dialog>` primitive. It already presents a clean modal at mobile size and removes background controls from the AX tree. A custom modal library would add cost without addressing the primary defect. Browser confirmation currently protects deletions; a branded confirmation is lower priority than fixing clipping. If added later, it must state the affected trip/entity, warn about cascading effects, retain a clear cancel path, and avoid an optimistic disappearance before server success.

**Complication:** focus restoration can fail when the invoker unmounts after a save. Returning to a stable trip heading is then more useful than sending focus to the document body. Closing while a save is pending also deserves a defined policy. These are behavioral questions to test with the refactored editor boundary, not reasons to rewrite all forms in a design pass.

## Validation, uncertainty and feedback

GOV.UK's validation pattern distinguishes user-correctable errors from service failures and recommends retaining input. Its error summary guidance connects a summary to field errors and directs focus to the summary following failed submission.[^8][^9] This is especially useful for longer AI-review forms where errors can be outside the viewport.

**Application judgment:** keep TripDock's provenance labels, batched questions and server validation. A missing date, a conflicting date and a provider configuration failure require different recovery actions. Do not reduce all three to a red toast. Use field-linked feedback for correctable values and a persistent service-error explanation near the action for unavailable generation. The current disabled Create explanation is helpful but should not become the only accessible route to discovering missing fields.

**Tradeoff:** a full validation-summary rewrite risks changing the carefully tested draft rules. This pass should preserve semantics, improve obvious labels/copy, and leave broader validation flow work with the appropriate behavior tests. No frontend-only declaration can establish that an AI draft is safe to persist.

WCAG 4.1.3 covers status messages that convey results, waiting, progress or errors without changing context; the information should be programmatically available to assistive technology without forcing focus.[^10] TripDock already uses status/alert roles in several surfaces. Keep success messages quiet and avoid creating a new live announcement for every hover or calendar move. A screen-reader session is still needed to assess interruption frequency.

## Contrast and themes

WCAG 1.4.3 requires 4.5:1 for ordinary text and 3:1 for qualifying large text, with exceptions such as inactive controls. The threshold concerns actual foreground/background combinations, not color names or the subjective appearance of a dark theme.[^11]

**Application judgment:** retain dark-first behavior and existing light mode. Measure important token combinations and inspect themed components, including date popovers and errors. Do not globally brighten every muted label or flatten patterned calendar papers without evidence. The current mint action color against deep green provides strong visual hierarchy; terracotta differentiates transport. Status meaning should continue to appear in words and shapes as well as color.

**Limitation:** token calculations alone miss opacity, compositing, gradients, disabled states and colors painted by browser controls. They support a spot audit, not certification. A visual comparison should use the same saved record and dimensions in both themes.

## Primary actions and progressive disclosure

GOV.UK button guidance emphasizes action-specific labels and cautions against unnecessary competing primary actions.[^12] TripDock's Create and Build draft are different routes with different commitments: one collects essentials manually, the other requests an unpersisted draft. Neither should be mislabeled as a saved result.

**Application judgment:** keep the desktop dual entry. On narrow screens reduce oversized panel spacing and expose a manual-start shortcut near the overview heading. Reordering only through CSS can make visual and keyboard order diverge, while a new mobile-only creation implementation would duplicate draft state. Reusing the existing manual expansion callback through an additional clearly named control is the smaller reversible change.

**Uncertainty:** no conversion or time-on-task data demonstrates that manual creation must precede AI for everyone. The recommendation is to expose both options, not infer user preference from a screenshot. A later small study with real trip planning tasks should measure whether people can find manual entry, recover from AI failure and change dates without assistance.

## Source inventory

All web references below are direct primary pages. Undated pages are recorded as living guidance accessed 11 September 2026 rather than assigned an invented publication date.

[^1]: W3C WAI. [Understanding SC 1.4.10: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Living WCAG 2.2 guidance. Used for mobile content versus calendar/table treatment.
[^2]: W3C WAI. [Understanding SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Living guidance. Used for target and spacing assessment.
[^3]: W3C WAI. [Understanding SC 2.5.7: Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html). Living guidance. Used for non-drag alternatives.
[^4]: W3C WAI. [Understanding SC 2.4.11: Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Living guidance. Used for sticky surfaces and focus visibility.
[^5]: W3C WAI. [APG Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). Living pattern. Used for trip navigation expectations.
[^6]: W3C WAI. [APG Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Living pattern. Used for focus and dismissal behavior.
[^7]: W3C WAI. [H102: Creating modal dialogs with the HTML dialog element](https://www.w3.org/WAI/WCAG22/Techniques/html/H102). Living technique. Used for retaining native dialogs.
[^8]: Government Digital Service. [Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/). GOV.UK Design System, living guidance. Used for correctable errors and retained input.
[^9]: Government Digital Service. [Error summary](https://design-system.service.gov.uk/components/error-summary/). GOV.UK Design System, living guidance. Used for long-form error discovery.
[^10]: W3C WAI. [Understanding SC 4.1.3: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). Living guidance. Used for feedback without focus theft.
[^11]: W3C WAI. [Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Living guidance. Used for actual color-pair checks.
[^12]: Government Digital Service. [Button](https://design-system.service.gov.uk/components/button/). GOV.UK Design System, living guidance. Used for primary actions and labels.
