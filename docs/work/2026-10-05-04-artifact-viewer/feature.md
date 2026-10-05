---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 5
flow: standard
created: 2026-10-05
---

# Artifact viewer

Child 4 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Read any artifact of a feature safely inside the app.

## Outcome

From the feature page I open the current stage's `review` HTML, or switch to any other artifact in the folder. HTML renders in an opaque sandboxed iframe through `grove-artifact://` with header CSP, and Mermaid works offline. Markdown without a companion renders in main. Requests outside the feature folder are refused.

## Scope

E-D8 (without the comment script). Design: Desired state 7 (viewing), "Artifacts and comments" (protocol and iframe), the artifact list bullet.

## Dependencies

2.

## Size estimate

2 days, about 4 slices.

## Flow log

- 2026-10-05: standard (default for an epic child; confirmed by the human in questions). Started ahead of child 3 (rolling-wave warning acknowledged; only depends on child 2).
