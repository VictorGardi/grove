---
feature: 2026-10-09-session-workflow-status
phase: plan
status: approved
version: 2
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 03-design.md@2
  - 04-structure.md@2
forced:
  - "Human explicitly requested skipping Grove approval gates and proceeding with implementation (2026-10-09); design, structure, and plan remain draft and are not marked approved."
---

# Plan: session workflow statuses

Force-authorized by the human to proceed despite unapproved design/structure; no artifact is self-approved by an agent.

Re-planned: the original section added a new marker control beside the card's
`icon` slot. The human changed one-way decision 3, so `03-design.md` is now v2
and this slice is written against it — the marker replaces the `icon` slot on
every session kind.

## Slice 1 — Persist and edit workflow status

- [ ] Write a failing test in `src/core/store/stateStore.test.ts`: a file written with `schemaVersion: 7` and one session loads as `schemaVersion: 8` with that session's `workflowStatus` equal to `'in-progress'`.
- [ ] Write a failing test in `src/core/sessions.test.ts`: a session from `newSession` has `workflowStatus` `'in-progress'`; `commands.sessionWorkflowStatus` sets each of the seven values on a known session; it returns `{ ok: false, error: 'not-found' }` for an unknown id; the value survives a restart; the session's `lastStatus`, `status` and grid membership are unchanged.
- [ ] Write a failing test in `src/renderer/src/workflowStatus.test.ts`: `WORKFLOW_STATUSES` has the seven values in order with the labels Backlog, In Progress, Blocked, In Review, Cancelled, Done, Pinned, each with a glyph name and a tone.
- [ ] Add `export type WorkflowStatus = 'backlog' | 'in-progress' | 'blocked' | 'in-review' | 'cancelled' | 'done' | 'pinned'` and the required field `workflowStatus: WorkflowStatus` to `Session` in `src/shared/types.ts`.
- [ ] Set `workflowStatus: 'in-progress'` in the object returned by `newSession` in `src/core/sessions.ts`.
- [ ] Change the state schema version from 7 to 8 in `src/shared/types.ts` (`StateFile`) and in the `loadState` default in `src/core/store/stateStore.ts`.
- [ ] Add the v7-to-v8 migration in `src/core/store/stateStore.ts` as `const v7ToV8 = (s: { sessions?: Session[] }) => ({ ...s, sessions: (s.sessions ?? []).map((x) => ({ ...x, workflowStatus: x.workflowStatus ?? 'in-progress' })) })` and register it in the `readVersioned` call in `loadState` as `{ ..., 7: v7ToV8 }`, raising the expected version argument to 8.
- [ ] Add `export function setWorkflowStatus(s: Session, workflowStatus: WorkflowStatus): Session { return { ...s, workflowStatus } }` to `src/core/sessions.ts`.
- [ ] Add `'session:workflowStatus': [{ id: string; status: WorkflowStatus }, Result<Session>]` to the invoke map in `src/shared/ipc.ts`, importing `WorkflowStatus`.
- [ ] Add `sessionWorkflowStatus(a: { id: string; status: WorkflowStatus }): Promise<Result<Session>>` to the commands interface in `src/core/core.ts`.
- [ ] Implement `sessionWorkflowStatus` in the commands object in `src/core/core.ts`, following `sessionRename`: look up with `findSession(id)`, return `{ ok: false, error: 'not-found' }` when absent, otherwise `replaceSession(setWorkflowStatus(session, status))` and return `{ ok: true, data: next }`.
- [ ] Register `handle('session:workflowStatus', (a) => core.commands.sessionWorkflowStatus(a), true)` in `src/main/ipc.ts`.
- [ ] Create `src/renderer/src/workflowStatus.ts` exporting `WORKFLOW_STATUSES`, an ordered array of `{ value: WorkflowStatus; label: string; glyph: string; tone: string }` for the seven values, matching the labels, glyphs and tones in `03-design.md`'s status presentation table.
- [ ] Create `src/renderer/src/components/ui/WorkflowStatusPicker.tsx` exporting `WorkflowStatusButton({ status, onPick })`, which renders the current status's glyph as a button with `aria-label` and `title` of its label, stops click propagation, and opens a menu of all seven choices built from `WORKFLOW_STATUSES`; selecting one calls `onPick(value)`. Expose it as an uncontrolled popover: the parent owns whether it is open.
- [ ] Create `src/renderer/src/components/ui/WorkflowStatusPicker.module.css` styling the button and the menu using existing tokens, giving each choice its `tone` colour.
- [ ] In `src/renderer/src/components/ui/ListRow.tsx`, keep the `icon` prop and render it unchanged; the button is passed in as `icon` by the callers.
- [ ] In `src/renderer/src/components/Sidebar.tsx`, replace the `icon={...}` expression in `SessionCard` (lines 58-60) with the picker button for every session kind, holding its open state in `SessionCard`; on pick, call `window.api.invoke('session:workflowStatus', { id: s.id, status })`.
- [ ] In `src/renderer/src/components/SessionsBoard.tsx`, replace `icon={<Icon name={x.kind} size={14} />}` (line 41) with the same picker button, wired to the same invoke.
- [ ] In `src/renderer/src/components/SidebarRail.tsx`, render the picker button in the tile's top-left corner, before the centred kind glyph, wired to the same invoke.
- [ ] Add a `.statusCorner` rule to `src/renderer/src/components/SidebarRail.module.css` positioning the marker at the tile's top-left, and keep the existing `.dot` (bottom-right) and `.grid` (bottom-left) rules as they are.
- [ ] Remove the now-unused `iconAgent`, `iconDone`, `iconGone` and `iconTerminal` rules from `src/renderer/src/components/Sidebar.module.css`, and the now-unused `done`, `shown` and `agent` locals in `SessionCard` only if nothing else reads them.
- [ ] Run `npm test -- src/core/store/stateStore.test.ts src/core/sessions.test.ts src/renderer/src/workflowStatus.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.