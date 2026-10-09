---
feature: 2026-10-09-session-workflow-status
phase: research
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 01-questions.md@1
forced: []
---

# Research: session workflow statuses

## Current session model and persistence

- `Session` is defined in `src/shared/types.ts`. The state file is version 7 and stores sessions plus UI state.
- `src/core/store/stateStore.ts` applies sequential migrations and fills defaults on load. `src/core/core.ts` is the single writer and strips live-only status fields before persisting sessions.
- Session creation is in `src/core/sessions.ts` and `src/core/core.ts`; typed renderer-to-main invokes are declared in `src/shared/ipc.ts`, handled in `src/main/ipc.ts`, and implemented by core commands in `src/core/core.ts`.

## Session-card views

- `Sidebar.tsx` renders the main session cards using `ListRow`. The top-left corner button is the grid-membership toggle (`plus`/`check`).
- `SessionsBoard.tsx` uses the same `ListRow` for session cards.
- `SidebarRail.tsx` renders compact session tiles with a live-status dot and a separate grid indicator.
- `ListRow.tsx` supports one floating top-left corner slot and right-side action controls. The new manual marker must coexist with the grid control rather than taking over its behavior.

## Xirp reference

The human-provided picker image establishes these workflow statuses and visual cues:

| Value | Label | Marker cue |
|---|---|---|
| `backlog` | Backlog | gray dashed ring |
| `in-progress` | In Progress | yellow partial ring |
| `blocked` | Blocked | orange partial ring |
| `in-review` | In Review | green review/clock glyph |
| `cancelled` | Cancelled | gray circled x |
| `done` | Done | blue checked circle |
| `pinned` | Pinned | orange pin |

The separate `In Review (Draft)` menu item is explicitly excluded. The reference is a visual guide; Grove's status marker is manual metadata and must not replace its live runtime status.
