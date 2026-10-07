---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 7
created: 2026-10-05
---

# Next actions

Child 5 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Move a feature forward from its page.

## Outcome

The feature page shows the current stage's next-action buttons from `workflow.yaml`. Each one starts a session that is already linked and prompted (`--prompt`) in the templated cwd. A `needs_input` action (Revise) asks for text first. Approve and other follow-ups are pasted into an idle linked session if one exists, and start a new linked session otherwise. Card states `ready` and `needs-review` drive which buttons are offered.

## Scope

E-D2 (actions, template variables, `stage_actions`), E-D3 (bracketed paste), E-D5 (idle detection for the paste target). Design: Desired state 6; "Sessions, backend and status" flow *Next action*; two-way row Prompt injection.

## Dependencies

2, 3.

## Size estimate

2 days, about 4 slices.

## On hold (2026-10-07)

Not built for now; new workflow features are on hold
([ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md)). Don't
start this child without the human reopening it.
