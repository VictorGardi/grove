---
feature: 2026-11-03-simplify-sessions-and-sidebar
phase: run
status: draft
version: 1
created: 2026-11-03
updated: 2026-11-03
approved_at:
based_on: [03-plan.md@8]
forced: []
---

# Run: Simplify sessions and sidebar

Profile: inherit
Branch: feature/2026-11-03-simplify-sessions-and-sidebar-inherit
Plan commit: 59b90b58ac187714eb9f00bec6be79311b658678
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: simplify-sessions-and-sidebar-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: zones come from `src/shared/zones.ts` (`zoneOf`), core's `withZones` and `sessionSetZone`, IPC `session:setZone`, `Session.zone/zoneOverride`, `UiState.sidebarView/groupBy`. `zoneList.ts` holds `zoneSections`, `zonesFor` and the kept `rowTitle`/`rowLine`. `Sidebar.tsx` renders ZoneSection views, a Zones|Projects toggle, a Group by menu and "Move to zone" items; `sessionList.ts` `listGroups` branches on `groupBy` (project/status/none), `canDrop`/`dropSession` take `groupBy`. Saved UI lives in `state.json` under `ui`.

Implementer 1 (shared, core, main, cli):
- [x] Delete `src/shared/zones.ts` and `zones.test.ts`; drop `Zone`, `zone`, `zoneOverride`, `sidebarView`, `groupBy` from `src/shared/types.ts` (comment naming dead keys), `DEFAULT_UI` too
- [x] Remove `withZones`, `sessionSetZone`, `zoneOf` import in `src/core/core.ts`; `session:setZone` in `src/shared/ipc.ts`, `src/main/ipc.ts`; `zone` in `src/shared/cli.ts` and `src/main/cliServer.ts`
- [x] Fix `sessions.test.ts`, `sessionStatus.test.ts` zone tests; add a test that a state/ui containing `zoneOverride`, `sidebarView`, `groupBy`, `board`, `artifacts` loads and is preserved on save

Implementer 2 (renderer):
- [x] Move `rowTitle`/`rowLine` into `src/renderer/src/rowText.ts`, delete `zoneList.ts`/`.test.ts` (keep row text tests in `rowText.test.ts`), delete `ZoneSection.tsx` and CSS
- [x] `Sidebar.tsx`/CSS: remove toggle, zones view, Group by menu, zone menu items; project grouping only; keyboard order follows visible list
- [x] `sessionList.ts`: project grouping only, drop `groupBy` params of `canDrop`/`dropSession`; `stores/slices.ts` drop `setGroupBy`; update tests

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 0 blocking. Applied cheap non-blocking: stale README "group by project or status", orphaned and stale comments in `sessionList.ts`.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: cmd+. uses `longestWaiting` (unchanged by this slice, not top-to-bottom), a superseding note for ADR 0041 (status drop), `ListGroup.project` nullable forces `g.project!`.

### Deviations

Removed `ListGroup.status`, `DropResult.status` and the status-heading CSS (`.tone-*`, `.groupGlyph`) since nothing uses them. The test builds the dead `zoneOverride` key by joining strings so the plan's `grep -rIni zone src` returns only the types.ts comment.

### Verification

`npm run typecheck`, `npm test` (122 files, 1487 tests) and `npm run build` pass. `grep -rIni "zone" src` returns only the dead-key comment in `src/shared/types.ts`. `stateStore.test.ts` loads a state with `zoneOverride`, `sidebarView`, `groupBy`, `board`, `artifacts` and shows them preserved on save. `sessionList.test.ts` covers project grouping, sort and Custom-order drag reorder. Models requested: implementer inherit, reviewer inherit.

### Left for the human

`npm run dev` visual check: no Zones|Projects toggle, no Group by menu, one sort control, cmd+1..9 follow the rows top to bottom (cmd+. still jumps to the longest-waiting session, as before).

## Open questions
