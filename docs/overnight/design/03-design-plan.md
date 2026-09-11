# Target design and decision log

## Target

A traveler should be able to start manually or describe a trip, finish missing essentials, save explicitly, reopen the same persisted trip, and maintain its itinerary and packing list. The calendar remains a calendar. Its contents should get more usable space than optional instructions on a phone. All significant gesture actions need discoverable non-drag controls.

## Prioritized implementation

1. **Restore mobile calendar width.** Replace the late two-column mobile rule with a full-width calendar and a bounded idea-pool row. Keep the desktop arrangement, readable day widths and existing persistence. Verify 320/390/768 px plus desktop and a short viewport.
2. **Make destination actions reachable.** Keep destination and stay controls visible within wide grouped headers as the calendar pans, or provide a compact equivalent action outside the merged header. Choose after testing the existing sticky table constraints.
3. **Expose manual creation early on narrow screens.** Reuse the existing expansion path and preserve mounted draft state. Reduce excess small-screen surface heights/spacing. Keep both AI and manual routes.
4. **Improve calendar instructions and keyboard access where bounded.** Describe click-to-edit scheduling as an alternative to dragging. Avoid introducing a partially implemented ARIA grid. Test native dialog Escape/focus and Schedule/Packing arrows.
   Restore dialog focus explicitly to a still-connected invoker after React unmount; retain native modal semantics. This addresses reproduced finding D10 without a new modal dependency.
5. **Verify real persistence and state recovery.** Create/edit/reload the isolated audit trip, transport, stay and activity; exercise packing and failure recovery. Use deterministic tests for AI/voice states without paid calls.

## Decisions and rollback

| Decision | Alternatives | Chosen default and reason | Feasibility / complication | Rollback |
| --- | --- | --- | --- | --- |
| Mobile calendar | Smaller sidebar; hide pool; separate agenda; stack pool | Stack, preserving all existing tools and enough width for a day | CSS and small markup change; short heights require scrolling strategy | Revert focused layout commit |
| Grouped destination tools | Sticky inner content; duplicate toolbar; one heading per date | Prefer sticky inner content if browser tests show reliable constraints; fallback compact toolbar only if needed | Table colspans and clip-path can interact with positioning | Revert header style/markup only |
| Manual entry | Reverse DOM order; CSS reorder; extra compact shortcut | Existing callback via compact shortcut plus mobile density adjustment | Must not duplicate form state or show two confusing save actions | Remove shortcut and responsive spacing rules |
| Branding | New palette/typeface; component library; current identity | Preserve supplied identity and tokens | Low risk, zero assets/dependency additions | Independent CSS reversal |
| Dialogs | Custom library; bespoke div overlay; native dialog | Retain native dialog | Browser focus restoration needs real testing | No primitive migration |
| AI review | Live provider evaluation; fake runtime drafts; deterministic tests | Deterministic test evidence and honest live limits | Cannot claim provider output or audio quality | No model/service changes |
| Calendar keyboard model | Roving grid now; preserve table plus editors | Bounded access improvements; defer full grid semantics until virtualization-aware design | A rushed grid role could worsen access | Isolate future keyboard change with behavior tests |

## Integration and ownership

Design documentation was committed before overlapping application edits. The completed frontend refactor `b707850` was merged into this isolated design branch in `89459a8`; its new file locations and AGENTS.md guidance were inspected and followed. Backend changes remain a separate branch; the current GraphQL contracts stay intact. Final verification records the included upstream work and design changes.

## Decisions requiring morning attention

No routine visual decision requires approval to proceed. Remaining decisions are about future scope: whether to fund a small representative-user and assistive-technology study, whether an agenda view is valuable after the mobile fixes, and whether to authorize a separately billed AI/voice validation session. None blocks the reversible work in this assignment. Deployment, authentication and shared-user scope remain excluded.
