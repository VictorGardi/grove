---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 2
flow: standard
created: 2026-10-05
---

# Visual foundation

Child 9 of epic `2026-10-05-opencode-feature-workspace`, built second (after
child 1, before child 2). Read the epic's `02-research.md` and `03-design.md`
first.

## Goal

The app looks deliberate and consistent, and later children build screens from shared parts, not inline styles.

## Outcome

Every walking-skeleton screen uses one set of design tokens (colour, type, spacing, radius) and a small set of base components: the sidebar and its rows, the ＋ modal, the confirm dialog, the error banner, the empty and "Session ended" panes, and the terminal frame. The components are Button, Modal, ListRow, Badge, Banner, and an app shell with a header area. The xterm theme reads from the same tokens. No visual inline styles remain in `src/renderer`.

## Visual reference

The human wants it to look similar to Xirp (Spotify): `../2026-10-05-opencode-feature-workspace/refs/xirp-reference.png`. The questions and design phases settle how close to follow it. The search bar (child 7), the Projects tab and tree (child 2), and statuses such as `waiting` (child 3) belong to other children: this child sets their look, not their behaviour.

## Scope

No `E-D` ids: renderer only, so IPC, state and core are untouched. Design: Desired state 2 (Spotlight-style modal) and 3 (the look of the sidebar rows, header and status dots, not the tree data); two-way row Terminal (colours).

## Dependencies

1 (walking skeleton). Child 2 depends on this child.

## Size estimate

2–3 days, about 4 slices, at most 2 own one-way decisions.

## Flow log

- 2026-10-05: standard (default for an epic child; confirmed by the human in questions)
