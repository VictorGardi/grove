# 0014. Grove's implementation stage completes when the human approves 06-implementation.md

Date: 2026-10-05

## Status

Accepted

## Context

The app derives each feature's stages only from `workflow.yaml` and four
predicates (ADR 0002). The example grove workflow needs a rule for when
implementation is complete. `05-plan.md` grows one slice section at a time,
so `all_checked: 05-plan.md` is true between slices. `06-implementation.md`
stays `draft` throughout, and grove has no "feature done" marker.

## Decision

The example workflow's last stage uses `artifact: 06-implementation.md`,
`complete_when: { field: status, equals: approved }`. grove-skills gains an
`implementation` approval unit in `grove-approve`: it validates that every
`04-structure.md` slice has a fully ticked `05-plan.md` section, then sets
`06-implementation.md` to `approved`. The change is recorded in
`docs/skills-changes.md` and is not built by the app.

## Consequences

- "Done" stays a human decision, like every other grove stage, and the
  workflow's generic `approve` action covers the last stage with no special
  case. While slices are in progress the card reads `needs-review`.
- Until the skills change lands, no grove feature reaches `done`; existing
  finished features need their 06 approved (or backfilled) by hand.
- Rejected: `all_checked: 05-plan.md` (false `done` between slices); an
  automatic completion field written by grove-implement (no human gate,
  another new field); a fifth E-D2 predicate counting structure slices
  (reopens the epic, encodes grove's format in app code).
