---
feature: 2026-11-03-simplify-sessions-and-sidebar
phase: run
status: approved
version: 1
created: 2026-11-03
updated: 2026-11-03
approved_at: 2026-11-03
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

## Slice 5

Session: simplify-sessions-and-sidebar-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the hold lives in `core.ts` (`startHold`, `settleHold`, `endHold`, `holdTimers`, `holdSent`, `escalateAfterSec`/`configEscalate`, `sessionEscalate`, the `noted` check in `sendToSession`, the `attention` clearing and the `notified` map); `held`, `handled`, `attention`, `HandledPrompt` and `ConfigFile.escalateAfterSec` in `types.ts`; `asksHuman` in `shared/attention.ts` reads `held`; `sessionStatus.ts`, `rowText.ts` read `held`/`attention`; `main/index.ts` notification body reads `attention.reason`; `sessions.escalate` in `shared/cli.ts`/`cliServer.ts`; `escalate` in `cli/args.ts`/`index.ts`; `sessions.send` carries `from`; `waitTurn` in `cliOps.ts` returns `status: 'waiting'` for permission/question (CLI exit 4). The two skills and README/CONTEXT describe the hold.

Implementer A (code):
- [x] Remove the hold and escalate from `core.ts`, `types.ts`, `attention.ts`, `cli.ts`, `cliServer.ts`, `cli/*`, `main/index.ts`, renderer readers; `from` out of `grove send`; `waitTurn` keeps waiting through permission/question (D7 A), `TurnResult.status` loses `waiting`, exit 4 gone; `escalateAfterSec` in an old config.json ignored and preserved on save
- [x] Rewrite tests; add the same-tick notification test, the plain-waiting `asksHuman` test and the config-survives-save test

Implementer B (docs/skills):
- [x] `resources/skills/grove/SKILL.md`, `resources/skills/grove-run/SKILL.md`, `README.md`, `CONTEXT.md`, new ADR 0049 superseding the hold parts of earlier ADRs

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 2 blocking: `README.md` still said `grove wait` exits 4, and `grove-run/SKILL.md` rules kept an "except a routine prompt" send exception that D7 removes. Both fixed by the planner directly (one-line text edits). Also applied: stale exit-code comment in `cli/output.ts`, a typo in `shared/cli.ts`, a new `waitTurn` test that the timeout still fires while a permission is waiting. Verdict: approved after 1 fix round. Non-blocking left: `TurnResult.waitingFor` is now always `null`; a comment in `attention.ts` mentions old board cards.

### Deviations

`saveConfig` writes only known keys, so core now keeps a `configExtra` of every other `config.json` key and spreads it back on save (this is how `escalateAfterSec` is preserved). `notified` and `dropStaleAttention` went with the hold. `TurnResult.status` is `'idle' | 'gone'`: exit 4 is gone from `grove wait`. No older ADR described the hold, so no supersession notes; ADR 0049 records the removal. `README.md` and `CONTEXT.md` needed only the exit-code line in README.

### Verification

`npm run typecheck` and `npm test` (118 files, 1392 tests) pass. The plan's greps return only the dead-key comment in `types.ts` and the preserve test in `projects.test.ts`; remaining `held` hits are unrelated (dictation, SessionGrid, worktrees, slug discovery map); `grep grace|handled|Grove holds resources/skills` returns only "handled in step 2" in `continue.md`. Tests added: same-tick child notification, `asksHuman` true for a plain waiting session, config with `escalateAfterSec` survives a save, `waitTurn` keeps waiting and still times out. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Update the grove and grove-run skills in the grove-skills repo that syncs them, if they are copied from there. ESLint was not run (config format error).

## Slice 6

Session: simplify-sessions-and-sidebar-slice-6-a2
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: this slice changes no source. The sidebar today (`Sidebar.tsx`, `ChildrenPopover.tsx`, `RunProgress.tsx`, `SessionMeta.tsx`) shows a "N children" chip popover and per-slice progress; the mockups are drawn against that vocabulary. The page is a scratch file kept outside the repo and published as a Claude artifact.

- [x] Pre-check: `continue.md` step 4 reads the latest `### Options` of a halted slice, asks the human to choose one (free text allowed), and starts a fresh child with a `Decision:` line; `slice-mode.md` step 2a records it and continues. A deliberate halt with a recorded pick is accepted.
- [x] Build one HTML page with 4 concepts (A-D), each drawing the badge, the via-parent row, the peek overlay, promote and the slice progress bar, in light and dark.
- [x] Publish it as an artifact and record the link here.

Models passed: implementer inherit (none used), reviewer inherit (none used).

### Mockups

Artifact: https://claude.ai/artifact/M4khBGdu5uyPCEssE6tGUM

Four concepts: A Quiet count, B Segments, C Ring, D Drawer. Each draws all five pieces.

### Halt

Deliberate halt: the plan's slice 6 stops the run so the human can pick a concept before slice 7 builds it. No code failed and no fix rounds ran. The page was published but not reviewed by a subagent, because it is a throwaway mockup and no source changed.

### Options

Recommended: Option 2 (B, Segments), because it shows state per slice at a glance and gives a waiting child the most visible, actionable row.

#### Option 1: Concept A, Quiet count
Pros: smallest change from today's chip popover; least visual noise.
Cons: progress is a thin bar only; a waiting child is a plain text line.
Changes design or outcome: no

#### Option 2: Concept B, Segments
Pros: one segment per slice by state; amber strip with an Answer action; live screen on hover.
Cons: busiest parent row; needs the most CSS.
Changes design or outcome: no

#### Option 3: Concept C, Ring
Pros: one glyph, very compact.
Cons: no room for per-child state; the peek shows only the latest child; the waiting pill replaces the via-parent row.
Changes design or outcome: no

#### Option 4: Concept D, Drawer
Pros: familiar expand/collapse; all children reachable in place.
Cons: children appear in the sidebar again when open, which weakens the hide-children goal; no live screen.
Changes design or outcome: no

Whichever option is chosen, the Decision child writes `Mockup pick: <concept>` into this file; slice 7 starts only when `grep -n "Mockup pick:" 04-run.md` matches. A mix ("A, with B's progress bar") is a free-text pick; state that it changes neither the design nor the outcome.

### Decision

Decision: Option 2, Concept B, Segments. One segment per slice by state; amber strip with an Answer action for a waiting child; live screen on hover. Cons: busiest parent row; needs the most CSS. Changes design or outcome: no. The human chose this in the parent session ("continue with concept B").

Mockup pick: B (Segments)

### Verification

`grep -n "claude.ai/artifact" 04-run.md` shows the link above. The page shows 4 concepts, each with all five pieces. Models requested: none used. After the decision: `grep -n "Mockup pick:" 04-run.md` matches `Mockup pick: B (Segments)`; no source changed.

### Left for the human

None. The pick is recorded; slice 7 builds concept B.

## Slice 7

Session: simplify-sessions-and-sidebar-slice-7-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `sessionList.ts` nests children under their parent (`Nest.kids`, `kidRows`, `kidsGroup`, done stacks, `kidsKey` collapse) and `isChild` ignores `Session.promoted`; `Sidebar.tsx` draws the nested children and a "N children" toggle; `RunProgress.tsx` is a single bar; `ChildrenPopover.tsx` is the header's jump list (kept there). `sessionRead` exists in core and the CLI server but there is no renderer channel, so `session:read` is added. The pick is concept B (Segments): one segment per slice by state, an amber strip with an Answer action for a waiting child, live screen on hover, promote on the child row in the peek.

Implementer 1 (logic and IPC, no UI files):
- [x] `sessionList.ts`: a child is hidden only when it is linked, not `promoted`, and its parent is on screen and unlinked; hidden children are listed in `Nest.kids`; add pure `viaParent(nest, parentId)` (hidden children whose own `asksHuman` is true, in sort order); `orderedSessions`/`visibleSessions` list each parent followed by its via-parent kids; drop `kidRows`, `kidsGroup`, `DoneStack`, `shownKids`, `Nest.collapsed`; `groupSize` counts rows; `canDrop` simplified
- [x] `family.ts`: pure `childSegments(parent, kids)` (done / run / wait / queued, padded to `progress.total`) and `linkKind(kid)`; tests in `sessionList.test.ts`, `family.test.ts`
- [x] `session:read` channel in `src/shared/ipc.ts` and `src/main/ipc.ts`

Implementer 2 (UI):
- [x] `Sidebar.tsx` + CSS: no child cards; parent shows the peek badge and segments; one via-parent strip per waiting child; `ChildPeek.tsx` overlay with live screen (polls `session:read`, status only when the pane is gone) and promote/unpromote; `RunProgress.tsx` draws segments; promoted children are ordinary rows

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found 0 blocking. Verdict approved, 0 fix rounds. Non-blocking left: `mostUrgent` is now unused outside its test; a failed or gone child that is not done shows as a running segment; the peek popover is positioned once on open and does not follow scrolling; the live screen keeps polling the last hovered row until the peek closes; the unpromote context item reuses the set-parent icon; the via strip has no aria-label; with no `grove progress` the segments carry no text label (the badge has the count).

### Deviations

The owner reviewed the running UI and replaced concept B's pill and hover peek (see Fix after review). The row shows one proportional bar and a drawer (`ChildDrawer`) replaces the peek; `App.tsx` `overlayOpen` now includes the open drawer so the terminal does not take keys. The drawer finds the sidebar edge from the first `<aside>`, is capped at `min(60vh, 100vh - 16px)` rather than full height, and a jump from it only focuses the child (the sidebar's picked set is not reset). `childrenSummary`, `linkKind`, `mostUrgent` and `ChildrenPopover` were deleted as unused. `session:read` is new in `src/shared/ipc.ts` and `src/main/ipc.ts`. An "Unpromote" item was added to a promoted session's context menu.

### Verification

`npm run typecheck`, `npm test` (119 files, 1393 tests) and `npm run build` pass. `sessionList.test.ts` asserts a parent with 2 running and 3 done children is one row, a promoted child is its own row, a waiting child gives exactly one via-parent entry and an answered one none, no child appears twice, and the via row follows its parent in the cmd+1..9 order. `family.test.ts` covers `barCounts` (plan with 11 done, 1 running, 2 queued; no plan with 24 children; a waiting child; a failed child is red and not running). `childDrawer.test.ts` covers tab filtering, the name filter and the ordering. Models requested: implementer inherit, reviewer inherit.

### Left for the human

The `npm run dev` check with a grove-run parent was not run: no child cards in the sidebar, the proportional bar and `done/total` text, the `n needs you` chip, the drawer (tabs, filter, live screen, promote and `Promote selected`, Escape and outside click, terminal not stealing keys), a waiting child showing once as a via-parent row that clears when answered, and cmd+1..9 following the visible rows. The drawer's position beside the sidebar and the bar's width on real rows are unchecked.

### Fix after review

Comment: the owner reviewed the running UI and chose a different design: remove the dot pill and the hover peek; one proportional bar on the row (done, failed, running, waiting, queued blocks sized by count, `done/total` or `<done> of <children>` text, an amber `<n> needs you` chip) and a drawer (tabs, name filter, per-child lines, live screen, `Promote selected`) because nothing may draw one mark per child. Changed: `barCounts` (family.ts) and `childDrawer.ts` with tests, `RunProgress.tsx` as the one bar, new `ChildDrawer.tsx`, `ChildPeek` deleted, `App.tsx` drawer state and `overlayOpen`, unused `mostUrgent`, `childrenSummary`, `linkKind` removed. Verification re-run: typecheck, tests and build pass. No plan Decision or the outcome changed.

### Fix 2

Comment: port the child-naming and relation changes of the tooling commit a5f27e7 into the shipped skill copies, and add naming guidance for ad-hoc children. Changed: `resources/skills/grove-run` (`SKILL.md` step 2 labels `<n> <short title>` with ` #<k>` for a second child, lookup by feature, parent and `<n> ` label prefix, children addressed by id, `--relation slice` retried without the flag on an older app; `references/continue.md`, `slice-mode.md`, `gates.md` the same), keeping the slice 4 and 5 text (no hold, `grove wait` without exit 4, parent never answers a prompt, no epics) as it was; `resources/skills/grove/SKILL.md` gets a child-naming rule with a good and a bad example. No plan Decision or the outcome changed.

### Fix 3

Comment: the owner reviewed the running drawer. Changed: one children list, so `ChildrenPopover` is deleted and the header chip in `SessionMeta` opens the same `ChildDrawer` as the sidebar bar (open state in `drawerStore.ts`, pure `toggledDrawer` tested; a trigger click toggles instead of closing and reopening); the checkboxes, selection and `Promote selected` are removed; each row has the sidebar's `WorkflowStatusButton` (`session:workflowStatus`), and the tabs, counts and bar follow the workflow status at once (tested); the row dot shows the child state (`DOT_TONE`: done green, running blue, waiting amber, failed red) instead of the live pane. Cause of the orange dots: `statusTone` is the live pane status and orange is `--status-running`, "a live pane with no agent status", which every session shows in a preview app whose empty data folder gets no agent status. The name column already takes the remaining width. Verification re-run: typecheck, tests (119 files, 1396 tests) and build pass. No plan Decision or the outcome changed.

Fix 4: branch on its own line below the bar

## Final summary

All seven slices are built on this branch. Zones and Group by are gone, sessions carry a typed link with a promote flag, boards and the epic concept are removed, the child-prompt hold is removed, and children are now hidden behind their parent with a proportional progress bar, a via-parent strip, and a drawer with live screen and promote. Unchecked in the real app: the visual and interactive points listed above. Not done on purpose: see the plan's risks.

### PR description

Simplify sessions and sidebar: fixed sidebar layout, typed session links with promote, no boards or epics, no child-prompt hold, children hidden behind their parent.

## Open questions
