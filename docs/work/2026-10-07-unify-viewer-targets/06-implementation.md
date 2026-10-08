---
feature: 2026-10-07-unify-viewer-targets
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-08
based_on:
  - 05-plan.md@1
forced: []
---

# Unify viewer targets — implementation

## Slice 1 — One project-relative file target and comment anchor

**Verified (Q5):** a feature folder can be outside the project folder
(`resolveRoot` doesn't check) or under a dot-folder. Human chose project-relative
only; written up in ADR 0032. Discovery is unchanged.

**Deviations / decisions**
- Migration numbers are v5→v6 (state) and v1→v2 (comments), not v3→v4: state was already at v5.
- Sent comments with an artifact anchor become file anchors with `path: <slug>/<path>` (label kept, jump may not resolve).
- `computeDiff` lost its `features` option; re-anchoring now walks draft file anchors and stats each file, instead of walking features.
- Not committed: the working tree held unrelated uncommitted changes in files this slice also touches.

**Checks:** `npm test` 616 passed; `npm run typecheck` clean; no lint command configured.
