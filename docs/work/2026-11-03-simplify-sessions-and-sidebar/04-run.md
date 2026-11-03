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

## Slice 2

Session: simplify-sessions-and-sidebar-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Session.parentId` is read in `src/shared/{sessionGroups,attention,types}.ts`, `src/core/core.ts` (creation path, notification/send paths), `src/main/cliServer.ts`, and renderer `rowText.ts`, `family.ts`, `sessionList.ts`, `Sidebar.tsx`, `ParentPicker.tsx`. `v9ToV10` in `stateStore.ts` calls `orphanChildren`, which must keep working on old-shape data, so it orphans inline on `parentId`. Schema version 10 is hard-coded in `loadState`.

Implementer A (shared, core, main, cli):
- [x] `types.ts`: `link`, `promoted`; `sessionGroups.ts`, `attention.ts`; `v10ToV11`, version bump, `state.v10.bak`
- [x] `--relation slice` in `args.ts`, `shared/cli.ts`, core creation; `grove list` adds `relation`
- [x] `sessionPromote`, `session:promote` IPC; tests and fixtures

Implementer B (renderer):
- [x] Replace `parentId` readers and fixtures with `link` in the renderer files and tests

Implementer C (docs):
- [x] `grove-run/SKILL.md` passes `--relation slice`; `CONTEXT.md`; new ADR 0047

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 0 blocking. Applied cheap non-blocking: CONTEXT.md wording so "promote" only means the flag. Approved, 0 blocking, 0 fix rounds. Non-blocking left: `sessionPromote` returns `not-found` for an unlinked session and stores `promoted: false` instead of deleting the key; `promoted` has no reader until slice 7; `state.v10.bak` keeps only the first backup; re-parenting by hand resets a slice link to `group`; `resources/skills/grove/SKILL.md` does not mention `--relation` (the plan limits it to grove-run).

### Deviations

`--relation` is also wired through `src/cli/index.ts` (the only place it reaches the wire). The backup is a `backUpV10` helper in `loadState`, not in `jsonFile.ts`. `cliServer` also validates `relation` (`bad-params`).

### Verification

`npm run typecheck` and `npm test` (122 files, 1494 tests) pass. The scoped `parentId` grep returns only `v9ToV10`/`v10ToV11`, their tests, the two `oc.emit` child fixtures and the `e.parentId` agent-event line in `core.ts`. `grep -rn relation resources/skills` hits `grove-run/SKILL.md` only. Tests cover the v10 to v11 migration and `state.v10.bak`, the v11 round trip, `--relation` validation, slice vs group on creation, orphaning and re-parenting, and `grove list` printing `parent` and `relation`. Models requested: implementer inherit, reviewer inherit.

### Left for the human

None.

## Slice 3

Session: simplify-sessions-and-sidebar-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ProjectPage.tsx` switches between `Board`, `SessionsBoard` and `ArtifactsBoard` on `ui.board`, and renders `ArtifactPage` when `ui.artifacts[project].open` is set; `BoardSwitch` sits in the App header and the menu/palette have `projectBoard` and `artifactsBoard` actions (`boardKey`, `artifactsKey` in `navigation.ts`). `artifactsBoard.ts` mixes board-only helpers (`filterClusters`, `neighbours`, `artifactsTo`, `boardViewTo`, `filterTo`, `previewKind`, `previewSrc`, `modifiedAgo`) with page helpers (`artifactClusters`, `pageClusters`, `openCard`, `artifactCrumbs`, `commentCard`, `stepKey`). `tree.ts` holds `boardColumns`/`sessionColumns` plus `linkedSessions`/`linkedFeature`. `ArtifactPage` is reached only through the board's open state, so with the board gone it needs a new focus: a `focusedArtifact: ArtifactRef | null` ui key, a fourth exclusive focus next to session, feature and project (core clears the others when one is set), and a `{ kind: 'artifact' }` content.

Implementer A (shared, core, main, docs):
- [x] `types.ts`: drop `board`, `artifacts`, `ArtifactsView`, `CanvasView` (if unused) from `UiState`/`DEFAULT_UI`, add `focusedArtifact`; `ipc.ts` and `menu.ts` drop `projectBoard`/`artifactsBoard`; `core.ts` makes `focusedArtifact` an exclusive focus (set, clear, absent-project handling); dead keys `board`/`artifacts` still load and are preserved on save, with a test
- [x] `README.md`, `CONTEXT.md` ("Board", "Project page", "Focus", "Feature page"), tests that touch these

Implementer B (renderer):
- [x] Delete `Board`, `SessionsBoard`, `ArtifactsBoard`, `ArtifactCard` (+css, render tests), `shell/BoardSwitch`, `boardColumns`/`sessionColumns` from `tree.ts`; split `artifactsBoard.ts` into `artifactData.ts` (+test)
- [x] Minimal `ProjectPage.tsx`: header, "new session", cmd+K hint; `App.tsx`, `navigation.ts`, `stores/slices.ts`, `tags.ts` follow; `content()` returns the artifact focus and renders `ArtifactPage` with prev/next inside its feature
- [x] `paletteItems.ts`: `artifact` entries (per feature artifact card, by name) and feature entries kept; tests

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 0 blocking. Applied cheap non-blocking: CONTEXT.md Group feature wording. Approved, 0 blocking, 0 fix rounds. Non-blocking left: FeaturePage file links and "Open review" still open the side viewer, so `ArtifactPage` is reached from cmd+K only; artifact palette entries carry the bare file name (the feature is in the detail text); `ArtifactPage` Back goes to the feature page.

### Deviations

New `ui.focusedArtifact` focus (exclusive with the other three, never restored on launch) carries the artifact page, since the board's `ui.artifacts.open` is gone. `tree.ts` keeps `linkedFeature` (Sidebar uses it); `canvasView.ts` and `previewGate.ts` were deleted as board-only. `artifactClusters` keeps features whose stage is not in `stages` (placed last).

### Verification

`npm run typecheck`, `npm test` (118 files, 1413 tests) and `npm run build` pass. `grep` for `boardColumns|artifactsBoard|BoardSwitch|openBoard` in `src` returns nothing. Tests cover dead `board`/`artifacts` keys loading and surviving a save, focus exclusivity, and cmd+K feature and artifact entries (`paletteItems.test.ts`). Models requested: implementer inherit, reviewer inherit.

### Left for the human

`npm run dev` visual check: menu has no Project Board or Artifacts entry, a project click shows the header, New session and the cmd+K hint, cmd+K finds a feature and an artifact by name and opens its page, a session's linked-feature tag opens `FeaturePage`.

## Slice 4

Session: simplify-sessions-and-sidebar-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Feature.group`/`parent`/`progress` come from `derive.ts` (`withGroups`) and `parse.ts` validates `group` and `parent_field`; readers are `FeaturePage.tsx` (Parent/Children), `App.tsx`, `navigation.ts` (`childrenOf`, feature crumbs), `tags.ts` (group colours, used by `Sidebar.tsx` and `ParentPicker.tsx`) and `artifactData.ts`. Epic text also sits in the two synced skill references, `AGENTS.md`, `grove.config.json` and `CONTEXT.md`.

Implementer A (code):
- [x] Drop `group`, `parent`, `progress` and the `active` card state; remove `withGroups`, `childrenOf`, `tags.group`; parser ignores `group` and `parent_field`; `resources/workflow.yaml` loses `epic` and `parent_field`; tests
Implementer B (docs):
- [x] Epic text out of `contract.md`, `gates.md`, `AGENTS.md`, `grove.config.json`, `CONTEXT.md`; new ADR 0048; superseded-in-part notes on ADR 0002 and 0018

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 0 blocking. Applied cheap non-blocking: a mangled comment in `artifactData.ts`, and the "starting a child while an earlier sibling..." soft gate in `AGENTS.md` (an epic-child rule whose counterpart left `gates.md`). Approved, 0 blocking, 0 fix rounds. Non-blocking left: ADR 0002 still describes group completion (covered by the supersession note); `contract.md` could say how an old `kind: epic` manifest loads, which belongs in the upstream tooling.

### Deviations

`CardState` lost `active` (only group completion produced it); `colorTags` takes only projects; `crumbs()` takes `(c, projects)`; feature breadcrumbs are project > feature. A `kind: epic` manifest falls back to the default kind and gets the existing `kind?` warning. The sync source of `contract.md` and `gates.md` (the grove-skills checkout, outside this repo) was not edited. `docs/skills-changes.md` line 28 keeps its historical "epic" mention.

### Verification

`npm run typecheck`, `npm test` (118 files, 1406 tests) pass. `grep -rIni epic` over `src resources AGENTS.md grove.config.json CONTEXT.md README.md` returns only the parser comment and the two tolerance tests; `grep -rIn childrenOf src` is empty; `resources/workflow.yaml` has no `group:` or `parent_field`. Parse test loads a file with `group: true` and `parent_field: parent`; derive test loads `kind: epic` as an ordinary feature. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Make the same epic-text edits to `contract.md` and `gates.md` in the grove-skills repo that syncs them, or the next sync restores them.

## Open questions
