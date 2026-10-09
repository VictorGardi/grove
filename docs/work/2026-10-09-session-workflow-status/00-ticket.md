Add manually chosen, persistent workflow statuses to sessions, using the Xirp status picker as the visual reference.

Decisions from the human-approved grilling conversation (2026-10-09):

- Workflow statuses are manual labels, independent of live agent status.
- Values: `backlog`, `in-progress`, `blocked`, `in-review`, `cancelled`, `done`, `pinned`. Do not include Xirp's separate `In Review (Draft)` option.
- New and legacy sessions default to `in-progress`.
- Clicking the status marker opens a picker. Statuses are labels only; `pinned` does not change cleanup or lifecycle behavior.
- Status is persisted across app restarts and does not change when live status changes.
- Show the marker in all session-card views. Keep the existing grid-membership action separately available.
- No extra filter or view is needed.
- Match the status names, glyphs, and colors in the supplied Xirp picker image.
