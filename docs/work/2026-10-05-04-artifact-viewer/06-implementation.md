---
feature: 2026-10-05-04-artifact-viewer
phase: implementation
status: draft
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@1
forced: []
---

# Implementation: artifact viewer

## Progress

- [x] Slice 1 — Tracer: an HTML artifact opens in the panel
- [ ] Slice 2 — Mermaid offline
- [ ] Slice 3 — Markdown and images
- [ ] Slice 4 — Navigation, switcher, Open review
- [ ] Slice 5 — Live reload and layout

## Slice 1 — Tracer: an HTML artifact opens in the panel

Verification: `npm test` 154/154 passed (run outside the Claude Code sandbox:
inside it the real-tmux tests in `src/core/backend/tmux.test.ts` fail with
`posix_spawnp failed`, unrelated); `npm run typecheck` clean; `npm run build`
clean. Manual checks (dev, `npm start`, traversal refusal) passed, confirmed
by the human on 2026-10-05.

Deviations (small, two-way):

- `closeViewer()` added to the store now (structure lists it under slice 5)
  because slice 1's panel has a close button.
- `ViewerTarget` lives in `src/shared/types.ts` (next to `UiState`, which uses
  it) rather than `src/shared/artifactUrl.ts`; `artifactUrl.ts` also exports
  `ARTIFACT_SCHEME` and `ASSETS_HOST` for main.
- `hash` is stored and emitted raw (no percent-encoding), so it round-trips.
- `src/core/store/stateStore.test.ts` round-trip fixture gained a `viewer`
  value (required by the type; also exercises its persistence).
- `VIEWABLE` is not created yet: slice 1 serves and links only `.html`/`.htm`
  (`/\.html?$/i` in `src/main/artifacts.ts` and `FeaturePage.tsx`); slice 3
  introduces the full list.

## Open questions
