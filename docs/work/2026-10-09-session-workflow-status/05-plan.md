---
feature: 2026-10-09-session-workflow-status
phase: plan
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced:
  - "Human explicitly requested skipping Grove approval gates and proceeding with implementation (2026-10-09); design, structure, and plan remain draft and are not marked approved."
---

# Plan: session workflow statuses

Force-authorized by the human to proceed despite unapproved design/structure; no artifact is self-approved.

## Slice 1 — Persist and edit workflow status

- [ ] Write a failing migration test in `src/core/store/stateStore.test.ts` confirming a schema version 7 session loads as schema version 8 with `workflowStatus: 'in-progress'`.
- [ ] Write a failing core command test in `src/core/sessions.test.ts` covering the default for new sessions, updating a known session to each status, rejection of an unknown session ID, persistence across restart, and preservation of its live status and grid membership.
- [ ] Write a failing renderer test in `src/renderer/src/workflowStatus.test.ts` covering all seven status values, labels, glyphs, and tones.
- [ ] Add the `WorkflowStatus` union and required `Session.workflowStatus` field in `src/shared/types.ts`; default new sessions to `in-progress` in `src/core/sessions.ts`.
- [ ] Bump the state schema to version 8 in `src/shared/types.ts` and `src/core/core.ts`; add the v7-to-v8 migration in `src/core/store/stateStore.ts` to default existing sessions to `in-progress`.
- [ ] Add the typed `session:workflowStatus` invoke in `src/shared/ipc.ts`, register it in `src/main/ipc.ts`, and implement `sessionWorkflowStatus({ id, status })` in `src/core/core.ts` using the existing session replacement and persistence path; return `not-found` for an unknown ID.
- [ ] Add the seven status labels, glyphs, and tones in `src/renderer/src/workflowStatus.ts`; implement the shared marker and picker in `src/renderer/src/components/ui/WorkflowStatusPicker.tsx` and its styles in `src/renderer/src/components/ui/WorkflowStatusPicker.module.css`.
- [ ] Add an always-visible marker slot to `src/renderer/src/components/ui/ListRow.tsx` and `src/renderer/src/components/ui/ListRow.module.css`; render the shared picker in `src/renderer/src/components/Sidebar.tsx` and `src/renderer/src/components/SessionsBoard.tsx`, keeping the sidebar grid-membership control separate.
- [ ] Add the shared picker to collapsed sidebar tiles in `src/renderer/src/components/SidebarRail.tsx` and `src/renderer/src/components/SidebarRail.module.css`, keeping the existing live-status dot and grid indicator independent.
- [ ] Run `npm test -- src/core/store/stateStore.test.ts src/core/sessions.test.ts src/renderer/src/workflowStatus.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
