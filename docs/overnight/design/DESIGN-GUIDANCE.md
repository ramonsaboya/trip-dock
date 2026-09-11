# Design guidance for contributors

Read this alongside `apps/web/AGENTS.md` when present; it supplements frontend rules and does not replace them.

- Preserve TripDock's supplied logo, default dark theme, green primary actions, serif overview headings and destination/transport paper language. Improve an observed task problem before adding decoration.
- Keep canonical trip data in PostgreSQL. Drafts remain editable and require explicit save plus server validation. Browser storage is only for established device preferences, never trip persistence.
- Reuse existing fields, date inputs, dialogs and feature callbacks. Do not duplicate the creation form to solve a mobile layout issue.
- Give the calendar readable width on phones. Two-dimensional grid scrolling does not excuse clipping the title, action controls, instructions or forms.
- Keep labels visible. Explain optional dates, missing requirements and uncertainty in words. Preserve typed input on recoverable failures.
- Every drag/resize workflow needs a reachable non-drag editor or control. Instructions must mention the alternative. Do not apply an ARIA role without its required keyboard behavior.
- Verify focus on open/close/save, Tab and Escape in dialogs, and arrow navigation for tabs/date inputs. Keep focus indicators visible within sticky/scrolling surfaces.
- Use shared theme tokens; check real foreground/background pairs in both themes. Larger mobile primary targets are useful, but WCAG AA target rules are not a blanket 44 px requirement.
- For responsive edits, inspect the real app at 320 and 390 px, one tablet width and desktop. Capture viewport evidence and measure overflow; use isolated saved data and reload for persistence claims.
- Keep test fixtures under tests and explicitly label simulated AI/voice evidence. Do not call a static preview proof of persistence or a token contrast check a full accessibility audit.
- Record intended behavior, alternatives, test evidence and rollback for material interaction changes. Avoid a new library or framework for a fix that fits the existing component structure.
