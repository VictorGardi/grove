---
feature: 2026-10-26-parent-child-jump
phase: research
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: []
forced: []
repo_heads: [adc94525311360850034bca01ce576609be8992c]
---

# Research: session children in the parent header

Facts only. Paths are relative to `src/`.

## Parent/child model

- `Session.parentId?: string | null` (shared/types.ts:40), persisted. Groups are one level deep: a parent never has a parent. There is no `children` field; children are derived from `parentId`.
- Group rules in shared/sessionGroups.ts: `leaderOf` (:8-10), `hasChildren` (:16, `sessions.some(x => x.parentId === id)`), `resolveParent` (:20, errors `'no-parent'`, `'is-parent'`; a child given as parent resolves to its leader), `withParent` (:31), `orphanChildren` (:43, called in core/core.ts:664 when a parent is removed), `canParent` (:49).
- No helper returns a parent's list of children. The nearest is the sidebar's `kids: Map<parentId, Session[]>` in renderer/src/sessionList.ts:109-111, which counts a child only if its parent is visible and is not itself a child.
- Parent is set by: core `sessionCreate({parent?})` (core/core.ts:90-91, :841-872); core `sessionSetParent` (core.ts:99, :1037) over IPC `'session:setParent'` (shared/ipc.ts:26, main/ipc.ts:52); the UI ParentPicker modal (renderer/src/components/ParentPicker.tsx, options from parentOptions.ts) and Sidebar context menu "Set parent…" / "Clear parent" (Sidebar.tsx:658-660); the CLI `grove new <kind> --parent REF | --child` (cli/args.ts:7, :22, :74; `--child` uses `GROVE_SESSION_ID`, cli/index.ts:48; resolved in main/cliServer.ts:76-100). GUI IPC `'session:create'` has no parent field.
- Unrelated: `Tracker.children` in core/status.ts:9 is agent subagent ids folded into a root's live status, not `parentId`. Features also have their own `childrenOf(feature)` (renderer/src/navigation.ts:86).

## What "active" can mean today (fields on `Session`, shared/types.ts:11-41)

- `lastStatus: 'running' | 'gone'` (tmux liveness, persisted), `endedAt`.
- `status?: 'working' | 'waiting' | 'idle'` and `waitingFor?: 'permission' | 'question' | 'done'`, live, never saved, computed by `statusOf` (core/status.ts:61).
- `startup?: {phase:'starting'} | {phase:'failed', reason}`.
- `workflowStatus`: manual label `'backlog'|'in-progress'|'blocked'|'in-review'|'cancelled'|'done'|'pinned'` (types.ts:9).
- Timestamps: `startedAt`, `seenAt` (last seen on screen), `lastFocusedAt` (set in `uiSet`, core.ts:1051-1052; orders the palette). No last-output timestamp on `Session`.
- Renderer: renderer/src/sessionStatus.ts `shownStatus` (:7: failed/gone/starting/working/waiting/idle/running), `statusView` (:14), `statusTone` (:23), `mostUrgent` (:31, order failed > waiting > working > idle > starting > running > gone; used for collapsed groups), `longestWaiting` (:47).

## Session header

- `ContentHeader` (renderer/src/components/shell/ContentHeader.tsx:27), props `{crumbs, meta?, right?}`. Wired in renderer/src/App.tsx:225-237: for a session, `meta` is `SessionMeta` with the breadcrumb lead, and `right` is a `.headerActions` div with only a "Diff" button (:233-236).
- `SessionMeta` (renderer/src/components/SessionMeta.tsx:14-45), one row: lead (project › feature › session label, `crumbs()` in navigation.ts:53-65), branch + PR link, feature tag + stage, `StatusDot` + label, spacer, `context`, `actions`. The same component is the grid pane header (SessionGrid.tsx:141), shared deliberately (comment :10-13). Neither header mentions parent or children today.

## Sidebar today

- Children render nested under the parent, indented (`.kids`, Sidebar.module.css:373), collapsible via `kidsKey(id)` in `ui.collapsed` (shared/groups.ts). `SessionCard` `kids` prop (Sidebar.tsx:47) renders a pill toggle with chevron and child count; collapsed, it shows the `mostUrgent` child's `StatusDot`. `kidsToggleHolding` (css :400, Sidebar.tsx:517) marks a collapsed parent whose hidden child has focus.
- SidebarRail.tsx:18-35: collapsed rail tiles with their own kids toggle.

## Focus and shortcuts

- Focus state `UiState.focusedSessionId` (types.ts:93), set by `setFocused(id)` (renderer/src/stores/slices.ts:101) → IPC `'ui:set'` → `uiSet` (core.ts:1043-1056), which pushes `focusHistory` and stamps `lastFocusedAt`. CLI `grove focus <ref>` → cliServer.ts:127-137.
- Shortcuts are native menu accelerators in main/menu.ts:23-65, sending `menu:action` with a `MenuAction` (shared/ipc.ts:4-8), handled in `runAction` (App.tsx:113-150). Taken: ⌘T, ⌘⇧T, ⌘J, ⌘N, ⌘W, ⌘1..9, Ctrl+Tab (previous focus), ⌘. (next waiting), ⌘B, ⌘⇧B, ⌘⌥B, ⌘G, ⌘⇧G, ⌘K (palette, `paletteItems.ts`).

## Sessions to renderer

- Push channel `'state:sessions': Session[]` (shared/ipc.ts:48-59), store subscription in renderer/src/stores/slices.ts:87-97.

## Commands and tests

- `npm test` (vitest run), `npm run typecheck`, `npm run build`, `npm run dev`.
- Tests: `src/**/*.test.ts` next to source, node environment, no jsdom/testing-library. Component tests use `renderToStaticMarkup` on hook-free components (renderer/src/boardRender.test.ts, projectPageRender.test.ts). renderer/src/noInlineStyles.test.ts fails on inline styles. Relevant: shared/sessionGroups.test.ts, renderer/src/sessionList.test.ts, sessionStatus tests, navigation tests.

## Open questions
