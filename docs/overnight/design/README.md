# TripDock design review

TripDock should remain a calm, local trip workspace with its existing green and orange identity, editable AI drafts, calendar papers, and personal packing tools. This review prioritizes making that workspace usable at narrow widths and making existing controls easier to discover and operate.

The baseline is commit `f80de19f32b39b2b77b940a480fabf4d6cebcd62`, inspected on 11 September 2026. The completed design branch includes frontend refactor `b707850` and verified mobile layout, creation and focus improvements. Evidence comes from the real application, local source, and current primary accessibility and design-system guidance. This is a product quality review, not a WCAG conformance certification or a usability study with representative participants.

## Review pack

- [Baseline map and audit](01-baseline-audit.md): responsibilities, journeys, actual observations and screenshots.
- [Research and applicability](02-research.md): standards, interaction guidance, competing approaches and evidence limits.
- [Target design and decisions](03-design-plan.md): priorities, chosen defaults, tradeoffs and rollback.
- [Implementation and verification](04-implementation-verification.md): completed work, checks, after evidence and integration notes.
- [Contributor design guidance](DESIGN-GUIDANCE.md): concise rules for future changes.

## Evidence environment

The audit runs this worktree's React/Vinext UI at `http://localhost:3301`, GraphQL API at port `4301`, and a new PostgreSQL 17 container named `tripdock-design-audit-postgres` on loopback port `55439`, database `tripdock_design_audit`. Existing migrations were applied to that empty database. The audit trip, activities and packing assignments are disposable records created through the real UI. No existing trip database was copied or modified. Screenshots are of this application and these isolated records, not a static preview. AI credentials are absent in the audit process; no billed generation or dictation calls are made.

The original checkout's untracked `docs/mvp-review-2026-09-09.md` was read as historical context and left untouched. No applicable AGENTS.md existed in the baseline checkout. Frontend-owned agent guidance was retained during integration; this folder's design guidance supplements it. The empty after-overview screenshot is explicitly labeled as browser-harness evidence in the implementation report; other after screenshots use the real audit records.
