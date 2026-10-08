---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: structure
status: approved
version: 2
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - 03-design.md@2
  - parent:04-structure.md@5
forced: []
---

# Structure: workflow, discovery and sidebar

Eight vertical slices (v2 adds 7–8 for the revised sidebar, design v2) inside the epic's scope for child 2 (E-D1, E-D2 with
`flows`, E-D7; Desired state 3–5, "`workflow.yaml` shape", two-way rows File
watching and Per-viewer UI state). Each slice leaves the app runnable. Every
slice also passes `npm run typecheck`.

## Slices

### Slice 1 — Tracer: features from the bundled workflow, read once

- **Outcome:** with this repo registered and no `workflow` in config, its
  feature folders appear under the project in the sidebar, each with its
  current stage label, read once at startup.
- **Files:** NEW `resources/workflow.yaml`,
  `src/core/workflow/{frontmatter,parse,derive}.ts` (+ tests),
  `src/core/discovery/folder.ts` (+ test). MODIFIED `src/shared/{types,ipc}.ts`,
  `src/core/core.ts`, `src/main/{index,ipc}.ts`,
  `src/renderer/src/stores/slices.ts`, `components/Sidebar.tsx`,
  `package.json` (`yaml@2.9.1`).
- **Signatures:** `readFrontmatter(text)`; `parseWorkflow(text)` (shape only);
  `resolveRoot(projectPath, discovery)`; `readFolder(dir, wf)`;
  `deriveFeatures(wf, folders, sessions)` (effective stages, current stage);
  push `state:features`.
- **Verify:** `npm test`: `frontmatter.test.ts` (dates stay strings, BOM/CRLF,
  unclosed block → error), `derive.test.ts` (kind ∩ flow, missing flow →
  default, first incomplete stage), `folder.test.ts` (temp dir: manifest
  required, stage artifacts parsed, dot-files skipped). Manual in
  `npm run dev`: register this repo; the epic and its children show stages;
  visual-foundation shows `implementation`.
- **Depends on:** —

### Slice 2 — Live discovery and a guarded workflow

- **Outcome:** creating, renaming or deleting a feature folder, or editing a
  status, updates the sidebar within ~1 s; changing `artifactRoot` in
  `grove.config.json` re-roots discovery; a custom `workflow` path is used;
  an invalid workflow shows a banner and the last valid one stays.
- **Files:** NEW `src/core/discovery/watcher.ts` (+ test). MODIFIED
  `parse.ts` (full validation), `core.ts`, `store/configStore.ts`,
  `src/renderer/src/App.tsx`, `package.json` (`chokidar@5.0.0`).
- **Signatures:** `watchRoot(root, onFolder)`; `FeaturesSlice.workflowError`;
  `ConfigFile.workflow?`.
- **Verify:** `npm test`: `parse.test.ts` (unknown stage id in a kind/flow,
  unknown predicate, reserved `{repo}`, YAML error with line/col),
  `watcher.test.ts` (add/rename/delete folder; skipped where `fs.watch` is
  blocked), `configStore` round-trips `workflow`. Manual in `npm run dev`:
  `mkdir` a folder with `feature.md` → appears; set `workflow` to a copy,
  break it → banner, features stay; fix it → banner clears.
- **Depends on:** 1

### Slice 3 — The tree

- **Outcome:** sidebar is project → epic → feature → linked sessions, plus
  unlinked sessions; done features sort after active ones; collapsed nodes
  survive restart; Cmd+1..9 follows the tree.
- **Files:** NEW `src/renderer/src/tree.ts` (+ test) replacing
  `sidebarOrder.ts`. MODIFIED `Sidebar.tsx`, `App.tsx`, `src/shared/types.ts`,
  `store/stateStore.ts` (`collapsed`, `view` defaults).
- **Signatures:** `buildTree(projects, features, sessions, ui): TreeNode[]`;
  `treeSessionOrder(tree): Session[]`.
- **Verify:** `npm test`: `tree.test.ts` (epic grouping by `parent`, done
  last, link to a missing slug → unlinked, `treeSessionOrder` includes
  collapsed), `stateStore` test: an old `state.json` loads with defaults.
  Manual: collapse the epic, restart, still collapsed; Cmd+2 focuses the
  second session in tree order.
- **Depends on:** 1

### Slice 4 — Feature page

- **Outcome:** clicking a feature shows its timeline (complete, current,
  unapproved, upcoming; a `small` feature shows no research, design or
  structure), card state, flags, warnings, its files with stage tags, and
  its linked sessions.
- **Files:** NEW `components/FeaturePage.tsx` (+ `.module.css`). MODIFIED
  `derive.ts` (unapproved, flags, warnings, card state), `core.ts` (`uiSet`
  exclusivity), `src/shared/types.ts` (`focusedFeature`), `App.tsx`,
  `Sidebar.tsx`.
- **Signatures:** `Feature.stages[].state`, `cardState`, `flags`,
  `warnings`, `artifacts`; `UiState.focusedFeature`.
- **Verify:** `npm test`: `derive.test.ts` (unapproved pass, skipped stage
  absent, `stale` flag, `flow?` warning, `backlog`/`ready`/`needs-review`/
  `done`), core test: focusing a feature clears `focusedSessionId` and the
  reverse. Manual: open the epic's page and visual-foundation's page.
- **Depends on:** 1, 3

### Slice 5 — Manual link

- **Outcome:** "Link…" on a session card picks a feature in its project or
  None; the session moves under that feature, stays there after restart,
  and the feature reads `running` while the session is live.
- **Files:** NEW `components/LinkPicker.tsx` (+ `.module.css`). MODIFIED
  `core.ts` (`sessionLink`, re-derive on sessions), `src/shared/ipc.ts`,
  `src/main/ipc.ts`, `derive.ts`, `Sidebar.tsx`.
- **Signatures:** `Commands.sessionLink({ id, feature })`; invoke
  `session:link`.
- **Verify:** `npm test`: core `sessionLink` (sets `feature`, pins; `null`
  unlinks and pins; unknown or other-project slug → `not-found`),
  `derive.test.ts` `running`. Manual: link a terminal to this feature; it
  moves; restart; still linked.
- **Depends on:** 3, 4

### Slice 6 — Board (appetite cut 1)

- **Outcome:** a List/Board toggle switches the content area to one column
  per workflow stage, `kind: feature` cards only, each child's card showing
  its epic's name; a click opens the feature page; the choice persists.
- **Files:** NEW `components/Board.tsx` (+ `.module.css`). MODIFIED `tree.ts`
  (`boardColumns`), `App.tsx`, `Sidebar.tsx` or `shell/ContentHeader.tsx`.
- **Signatures:** `boardColumns(stages, features): { stage, cards }[]`;
  `UiState.view`.
- **Verify:** `npm test`: `tree.test.ts` `boardColumns` (epics excluded,
  done features in the last column, epic name attached). Manual: toggle to
  Board, restart, still Board; click a card → feature page.
- **Depends on:** 4

### Slice 7 — Sessions | Features tabs (v2)

- **Outcome:** the sidebar header has Sessions | Features tabs. Sessions
  lists every session under collapsible project headers, by start time,
  terminals muted, with no feature rows; Features shows project → epic →
  feature without sessions. The tab survives restart; Cmd+1..9 follows the
  Sessions order whichever tab is shown.
- **Files:** MODIFIED `src/renderer/src/tree.ts` (+ test),
  `components/Sidebar.tsx` (+ `.module.css`), `components/ui/ListRow.tsx`
  (+ `.module.css`, `muted` tone), `App.tsx`, `stores/slices.ts`,
  `src/shared/types.ts` (`UiState.sidebarTab`), `store/stateStore.test.ts`.
- **Signatures:** `buildTree(projects, features, ui)` (no sessions);
  `sessionGroups(projects, sessions, ui): { project; key; collapsed; sessions }[]`;
  `sessionOrder(groups): Session[]`; `UiState.sidebarTab`.
- **Verify:** `npm test`: `tree.test.ts` (`sessionGroups` keeps config
  project order and start-time order, includes linked sessions, marks
  collapsed; `sessionOrder` includes collapsed; `buildTree` has no session
  nodes), `stateStore` test: an old `state.json` loads with
  `sidebarTab: 'sessions'`. Manual in `npm run dev`: switch tabs, restart,
  tab kept; Cmd+2 focuses the second session in Sessions order.
- **Depends on:** 3

### Slice 8 — Feature line on the session card (v2)

- **Outcome:** a linked session's card shows its feature (epic-colour dot,
  title, current stage · card state); clicking that line opens the feature
  page in place of the terminal. A link to a slug that isn't there shows no
  line.
- **Files:** MODIFIED `tree.ts` (+ test, `linkedFeature`),
  `components/Sidebar.tsx` (+ `.module.css`).
- **Signatures:** `linkedFeature(session, features): Feature | null`.
- **Verify:** `npm test`: `tree.test.ts` `linkedFeature` (same project and
  slug → the feature; other project, missing slug or `null` → `null`).
  Manual: link a session to this feature; its card shows the line; click →
  feature page; click the card → back to the terminal.
- **Depends on:** 5, 7

## Appetite check

The epic gives this child 4–5 days and about 6 slices: six slices, with
Board last so cut 1 drops only slice 6. v2 adds two small UI slices (about
half a day) at the human's request, after the six were built.

## Deferred

- Keeping the last valid workflow across restarts; live re-read of
  `config.json` hand edits.
- Packaged `resources/` path (child 8); `waiting` card state (child 3).
- The grove-skills `implementation` unit (`docs/skills-changes.md` §1),
  built in grove-skills, not here.

## Rollout / migration

None: all new state is additive at `schemaVersion: 1` (D2). Until the
skills change lands, no grove feature shows `done` (ADR 0014).

## Open questions
