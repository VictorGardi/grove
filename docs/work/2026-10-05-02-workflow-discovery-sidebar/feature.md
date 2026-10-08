---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 3
flow: standard
created: 2026-10-05
---

# Workflow, discovery and sidebar

Child 2 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Features appear and move through stages driven only by `workflow.yaml`.

## Outcome

With a project registered, its feature folders appear live in a project → epic → feature tree, alongside unlinked sessions. Each feature shows its derived stage and card state. The feature page shows the stage timeline (marking "unapproved" passes) and lists the feature's artifacts. I can link a session to a feature by hand. A List/Board toggle groups features by stage. An invalid `workflow.yaml` shows a banner and keeps the last valid one. Each feature's stages come from its kind and flow (`flows` in `workflow.yaml`); stages its flow skips don't appear on its timeline. An example grove `workflow.yaml`, declaring `full`, `standard` and `small`, ships with the app.

## Scope

E-D1 (discovery), E-D2 (including `flows`, v3), E-D7 (`workflow` path, `linkPinned`, UI state). Design: Desired state 3 (tree; status dots come from child 3), 4 (discovery and manual link), 5; "`workflow.yaml` shape"; two-way rows File watching and Per-viewer UI state.

## Dependencies

1, 9 (tokens and base components).

## Size estimate

4–5 days, about 6 slices. Board is the last slice (appetite cut 1).

## Flow log

- 2026-10-05: standard (default for an epic child; confirmed by the human in questions)
