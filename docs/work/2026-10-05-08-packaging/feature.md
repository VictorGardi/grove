---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 10
created: 2026-10-05
---

# Packaging

Child 8 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

A `.app` I can use as my daily driver.

## Outcome

A built `grove.app` launches from `/Applications`. It includes node-pty (`asarUnpack`, `spawn-helper` executable), the shipped tmux config and the example `workflow.yaml`, and it runs sessions without a dev checkout. It is signed, or ad-hoc signed if cut 4 applies. `docs/skills-changes.md` records the hub/multi-repo prerequisite.

## Scope

E-D3 (shipped tmux config), E-D4 (main/renderer build). Design: two-way rows node-pty and Skills changes; appetite cut 4.

## Dependencies

Children 1–4, 9 and 10, plus the standalone features
`2026-10-07-session-diff` and `2026-10-07-review-comments` (ADR 0020).
Children 5–7 are on hold or superseded and no longer block packaging.

## Size estimate

1 day, about 3 slices.

## Re-scope (2026-10-07)

Built last, after `2026-10-07-review-comments` and the grove CLI (which may
need an "Install CLI" step here). Dependencies 5–7 no longer
apply ([ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md)).
