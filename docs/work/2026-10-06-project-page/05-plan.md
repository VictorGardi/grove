---
feature: 2026-10-06-project-page
phase: plan
status: approved
version: 4
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - 01-questions.md@1
forced:
  - "size M / UI-state shape change in small flow: every decision, including the ui-state shape, was made by the human in grilling and recorded in ADR 0018 and 00-ticket.md; small flow chosen deliberately (2026-10-06)"
---

# Plan: project page

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

Decisions come from `00-ticket.md` ("Decisions chosen in grilling", 1–13) and
ADR 0018. Slices: (1) project page and navigation; (2) Sessions board and the
Features | Sessions switch; (3) rich feature cards; (4) `CONTEXT.md`.

## Slice 1 — Project page, three-way focus, Projects tab, breadcrumbs, ⌘B

Context (code at `3642102`): `UiState` (`src/shared/types.ts`) has
`focusedSessionId`, `focusedFeature`, `view: 'list' | 'board'` and
`sidebarTab: 'sessions' | 'features'`. `loadState`
(`src/core/store/stateStore.ts`) spreads the saved `ui` over `DEFAULT_UI`, so
a saved key the type lacks survives in memory and on disk. `uiSet`
(`src/core/core.ts`) keeps the two focuses exclusive. `onScreenId()` treats a
session as on screen only with `view === 'list'` and no focused feature.
`dropSessions` clears a focused session that is removed. Notification clicks
(`src/main/index.ts`) call `uiSet({ view: 'list', focusedSessionId })`. The
renderer (`App.tsx`) shows the Board whenever `view === 'board'`, which hides
sidebar clicks (bug 3). `ContentHeader` crumbs are plain strings. The sidebar
Features tab (`buildTree`, `FeatureRow`) is the only way to reach group
features. Menu actions travel `buildMenu` (`src/main/menu.ts`) →
`menu:action` → `App.tsx` handler. Electron menu accelerators fire even when
xterm.js has focus (⌘T works the same way).

Behaviour defined here, from decisions 1, 6–11:
- `UiState`: `view` removed; `focusedProject: string | null` added (a project
  id); `sidebarTab: 'sessions' | 'projects'`. Setting any of
  `focusedSessionId`, `focusedFeature`, `focusedProject` to non-null clears
  the other two.
- Loading: a saved `view` key is dropped. A saved `sidebarTab: 'features'`
  reads as `'projects'`. No `schemaVersion` change (same tolerant-read path as
  `seenAt`).
- "Last project page" (decision 10): when a focused session is removed, or a
  focused feature disappears from discovery, `focusedProject` becomes its
  project. When nothing at all is focused, the renderer shows the first
  project's page. When the focused project is removed, `focusedProject`
  becomes null.
- Content: focused project → project page (the Features board filtered to
  that project; the board header switch comes in slice 2). Focused feature →
  feature page. Focused session → terminal or ended view. Nothing focused →
  first project's page, or the empty hint with no projects.
- Crumbs: project page `[project]`. Feature `[project › parent title ›
  feature]` (parent only when it exists in the same project). Session
  `[project › linked feature › session label]`, or `[project › label]`. Every
  segment but the last is clickable: project → project page, feature/parent →
  feature page.
- ⌘B (View menu "Project Board"): opens the project page of the focused
  feature's or session's project, else the focused project, else the first
  project. (The switch on the project page arrives in slice 2.)
- Sidebar: tabs Sessions | Projects. A Projects row: folder icon, name, live
  session count (`lastStatus === 'running'`), and a waiting badge
  (`shownStatus === 'waiting'`) when non-zero. Selected when it's the focused
  project. Hover actions new session and remove. Clicking opens the project
  page.
- Parent/child (decision 7, kept in this slice so group features stay
  reachable once the Features tab is gone): the parent tag on a board card
  opens the parent's feature page. A feature page with children lists them
  (title, current stage label, card state), each opening its page; a child's
  page shows "Parent: <title>" linking up. Code names `epic` become `parent`.

Steps:

- [x] Write failing tests in `src/core/store/stateStore.test.ts`: round-trip
  fixture without `view` and with `focusedProject: 'p'`,
  `sidebarTab: 'projects'`; a saved ui with `view: 'board'` and
  `sidebarTab: 'features'` loads with no `view` key and
  `sidebarTab: 'projects'`. Update the two old-ui tests that write `view`
  so they still pass (`toEqual` against `DEFAULT_UI`).
- [x] Write failing tests in `src/core/features.test.ts`: the three focuses
  stay exclusive (set session, then feature, then project, then session;
  check the other two are null each time).
- [x] Write a failing test in `src/core/sessions.test.ts`: removing the
  focused session sets `focusedProject` to its project and
  `focusedSessionId` to null.
- [x] `src/shared/types.ts`: `UiState` drops `view`, adds
  `focusedProject: string | null`, `sidebarTab: 'sessions' | 'projects'`;
  `DEFAULT_UI` gets `focusedProject: null`, `sidebarTab: 'sessions'`, no
  `view`.
- [x] `src/core/store/stateStore.ts` `loadState`: build `ui` as
  `{ ...DEFAULT_UI, ...rest }` where `rest` is the saved ui without `view`,
  and map `sidebarTab: 'features'` to `'projects'`.
- [x] `src/core/core.ts`: `uiSet` clears the other two focuses for whichever
  of the three is non-null in `partial`. `onScreenId()` returns
  `focusedSessionId` when the window is focused (no `view` check; the focuses
  are exclusive). `dropSessions`: when the focused session is dropped, set
  `ui` to `{ focusedSessionId: null, focusedProject: <its projectId> }`.
  Where features are re-derived, if `ui.focusedFeature` no longer matches an
  item, set `focusedFeature: null, focusedProject: <its projectId>`.
  `projectRemove`: when `ui.focusedProject === id`, set it to null.
- [x] `src/main/index.ts` notification click: `uiSet({ focusedSessionId: s.id })`.
  `src/shared/ipc.ts` `MenuAction` adds `{ type: 'projectBoard' }`.
  `src/main/menu.ts` View submenu: first item
  `{ label: 'Project Board', accelerator: 'CmdOrCtrl+B', click: () => send({ type: 'projectBoard' }) }`.
- [x] Write failing tests `src/renderer/src/navigation.test.ts` for a new
  `src/renderer/src/navigation.ts`:
  `content(ui, projects, sessions, features)` →
  `{ kind: 'project', project } | { kind: 'feature', feature } | { kind: 'session', session } | { kind: 'none' }`
  (nothing focused → first project; a focus pointing at a missing item falls
  back the same way); `crumbs(target, projects, sessions, features)` →
  `{ label: string; to?: Partial<UiState> }[]` per the rules above, `to`
  being the `ui:set` partial for clickable segments;
  `boardProject(ui, projects, sessions, features)` → the project id ⌘B
  opens, or null with no projects; `childrenOf(feature, features)` → same
  project, `parent === feature.slug`, sorted by slug with done last.
  Implement `navigation.ts` until they pass.
- [x] `src/renderer/src/tree.ts`: delete `buildTree`, `TreeNode`,
  `featureKey`, `bySlugDoneLast` (moves to `navigation.ts`); rename
  `BoardCard.epic` → `parent` (`{ title, slug } | null`); `boardColumns`
  takes features already filtered by the caller. Update
  `src/renderer/src/tree.test.ts` (drop `buildTree` tests, rename `epic`).
- [x] `src/renderer/src/stores/slices.ts`: remove `showSession`,
  `openFeature`, `setView`; add `openProject(id)` →
  `ui:set { focusedProject: id }`; add `go(to: Partial<UiState>)` →
  `ui:set to`. Update callers (`App.tsx` top-bar waiting jump uses
  `setFocused`).
- [x] `src/renderer/src/components/shell/ContentHeader.tsx`: crumbs become
  `{ label; onClick? }[]`; a clickable crumb is a `<button>` styled like
  `.parent` with hover underline (`ContentHeader.module.css` `.link`).
  Separator `›`.
- [x] Delete `src/renderer/src/components/shell/ViewToggle.tsx` and its
  `.module.css`.
- [x] New `src/renderer/src/components/ProjectPage.tsx` (+ `.module.css`):
  renders `<Board>` with the project's features; `onOpen` → `focusFeature`,
  `onOpenParent` → `focusFeature` of the parent. `Board.tsx`: drop the
  project tag (one project per board), parent tag rendered as a clickable
  `Tag` (button) that stops propagation.
- [x] `src/renderer/src/components/FeaturePage.tsx`: props add
  `parent: Feature | null`, `children: Feature[]`, `onOpenFeature(f)`. Show a
  "Parent" line under the meta when `parent`, and a "Children" section
  (`ListRow` per child: title, meta = current stage label, status =
  card-state label) before "Sessions" when `children.length > 0`.
- [x] `src/renderer/src/App.tsx`: use `content()` and `crumbs()`; render
  `ProjectPage`, `FeaturePage`, terminal/ended view, or the empty hint;
  `ContentHeader` without `right`; menu handler adds
  `projectBoard` → `openProject(boardProject(...))` when non-null.
- [x] `src/renderer/src/components/Sidebar.tsx`: tabs Sessions | Projects;
  remove `FeatureRow`, `renderNode`, `buildTree` use; add `ProjectRow`
  (ListRow: folder icon with project tag colour, title = name, meta =
  `N live` text, waiting `Badge tone="waiting"` when > 0, `tone` selected
  when focused, actions: new session ＋, remove 🗑 with the existing
  refused message). Badge gets a `waiting` tone
  (`ui/Badge.tsx`, `Badge.module.css`: background `var(--status-waiting)`,
  color `var(--chrome-bg)`).
- [x] Run `npm run typecheck`
- [x] Run `npm test`
- [x] Run `npm run build`

Manual check (human): the app launches on the first project's page; clicking
a session while on a project page shows its terminal; breadcrumbs go up; ⌘B
from a session opens its project's board, also with the terminal focused;
Projects tab rows show counts and open their pages; a parent tag opens the
parent page, and the parent lists its children.

## Slice 2 — Sessions board and the Features | Sessions switch

Context (code at `3b2c32a`): the project page (`ProjectPage.tsx`) renders the
Features `Board` only. `content()` / `boardProject()` live in
`src/renderer/src/navigation.ts`; ⌘B sends `projectBoard` and `App.tsx`
opens `boardProject(...)`. `shownStatus()` (`sessionStatus.ts`) gives
`running | gone | working | waiting | idle`; `statusView()` gives the label
and `StatusTone`. The store tracks `waitingSince` (ms, renderer memory) via
`trackWaiting`; no time is kept for other statuses. `Session.endedAt` is
persisted. `ListRow` has `tone: 'waiting'` (amber card). `linkedFeature()` and
`colorTags()` give a session's feature and its tag colour. No duration
formatter exists.

Behaviour defined here, from decisions 3, 5 and 9:
- `UiState.board: 'features' | 'sessions'`, default `'features'`, persisted
  (old files get the default via `loadState`'s defaults merge).
- The project page header (`ContentHeader` `right`) shows a Features |
  Sessions switch, styled like the removed `ViewToggle` (two `Button`s,
  `size="sm"`, `secondary` when active, `ghost` otherwise, `aria-pressed`).
- Sessions board columns, in order: Waiting (`waiting`), Working
  (`working`, `running`), Idle (`idle`), Ended (`gone`). Within a column,
  sessions by `startedAt`. Only the project's sessions.
- Session card (`ListRow`): title = label; icon = kind icon as in the sidebar
  card; meta = linked feature `Tag` (clickable → feature page) when linked;
  status = `statusView()` label plus " · <duration>"; tone `waiting` for
  waiting sessions, else `default`. Clicking focuses the session.
- Time in state: the store keeps `statusSince: Record<id, { status: ShownStatus; since: number }>`
  (renderer memory, reset when the status changes; first seen = app
  start or session creation). Ended sessions use `endedAt` when set.
  Duration text: `<1m` → "now", minutes "Nm", hours "Nh", days "Nd". The
  board re-renders every 30 s.
- ⌘B: when the content area shows a project page, it switches `board`
  (features ↔ sessions); otherwise it opens the context project's page.

Steps:

- [x] Write failing tests in `src/renderer/src/tree.test.ts` for
  `sessionColumns(sessions)` → `{ id: 'waiting' | 'working' | 'idle' | 'ended'; label: string; sessions: Session[] }[]`
  per the mapping above.
- [x] Write failing tests in `src/renderer/src/sessionStatus.test.ts` for
  `trackStatus(prev, sessions, now)` (keeps `since` while the status is
  unchanged, resets it on change, drops removed sessions, returns `prev`
  when nothing changed) and `duration(ms)` ("now", "5m", "3h", "2d").
- [x] Write failing tests in `src/renderer/src/navigation.test.ts` for
  `boardKey(ui, projects, sessions, features)` → `Partial<UiState> | null`:
  `{ board: 'sessions' }` / `{ board: 'features' }` when the content is a
  project page (including the first-project fallback), else
  `{ focusedProject: <boardProject> }`, null with no projects.
- [x] Write a failing test in `src/core/store/stateStore.test.ts`: an old ui
  without `board` loads `board: 'features'`; the round-trip fixture carries
  `board: 'sessions'`.
- [x] `src/shared/types.ts`: `UiState.board: 'features' | 'sessions'`;
  `DEFAULT_UI.board = 'features'`.
- [x] Implement `sessionColumns` (`tree.ts`), `trackStatus` and `duration`
  (`sessionStatus.ts`), `boardKey` (`navigation.ts`, replacing
  `boardProject` use in `App.tsx`; keep `boardProject` exported for it).
- [x] `src/renderer/src/stores/slices.ts`: `statusSince` state updated next
  to `waitingSince` in `setSessions`; `setBoard(board)` → `ui:set { board }`.
- [x] New `src/renderer/src/components/shell/BoardSwitch.tsx`
  (+ `.module.css` `.toggle { display: flex; gap: var(--sp-1); }`).
- [x] New `src/renderer/src/components/SessionsBoard.tsx`: columns from
  `sessionColumns`, cards as above; reuse `Board.module.css` classes by
  importing it. A 30 s `setInterval` state tick re-renders durations.
- [x] `ProjectPage.tsx`: props add `board`, `sessions`, `statusSince`,
  `onFocusSession`; renders `Board` or `SessionsBoard`. `App.tsx`: pass
  them; `ContentHeader right={<BoardSwitch …/>}` on a project page; the
  `projectBoard` menu action applies `boardKey(...)` via `go`.
- [x] Run `npm run typecheck`
- [x] Run `npm test`
- [x] Run `npm run build`

Manual check (human): the switch flips the board; ⌘B on a project page
flips it, elsewhere opens the board; sessions sit in the right columns and
move as their status changes; waiting cards are amber; durations count up;
clicking a card opens the session; a linked feature tag opens the feature.

## Slice 3 — Rich feature cards

Context (code at `1f16a41`): `Board.tsx` renders each feature as a `ListRow`
(title, clickable parent `Tag`, status = card-state label with tone
`idle`). `boardColumns` excludes group features, so group features never
appear as cards; their progress already shows on their feature page.
`shownStatus` / `statusView` give each session's status and tone;
`StatusDot` renders a tone dot. Tokens: `--card-waiting-bg`,
`--card-waiting-border`, `--card-glow`, `--status-*`.

Behaviour defined here, from decision 4 (Xirp-style feature cards):
- A card (`FeatureCard` in `Board.tsx`, own styles in `Board.module.css`)
  shows, top to bottom: the card-state label with a status dot; the title;
  the parent tag (clickable, as now); a row of linked-session status dots
  (one `StatusDot` per linked session, `title` = "label · status"), omitted
  with no linked sessions.
- Card-state tone: `waiting` → waiting, `running` and `active` → working,
  `needs-review` → finished, `ready` → running, `backlog` → idle,
  `done` → gone.
- When any linked session's shown status is `waiting`, the card uses the
  waiting look (`--card-waiting-bg`, `--card-waiting-border`, glow) and
  shows an "Input required" strip under the title.
- Progress for group features: no change, since group features are not
  board cards (decision 1 keeps the board to non-group features).
- Linked sessions: same project, `session.feature === feature.slug`, by start
  time (`linkedSessions` in `tree.ts`).

Steps:

- [x] Write a failing test in `src/renderer/src/tree.test.ts` for
  `linkedSessions(feature, sessions)` (same project and slug only, by
  `startedAt`).
- [x] Implement `linkedSessions` in `src/renderer/src/tree.ts`.
- [x] `src/renderer/src/featureLabels.ts`: export
  `CARD_STATE_TONES: Record<CardState, StatusTone>` per the mapping above.
- [x] `src/renderer/src/components/Board.tsx`: prop `sessions: Session[]`;
  replace the `ListRow` with a local `FeatureCard` per the layout above.
  `Board.module.css`: `.card`, `.card:hover`, `.waiting`, `.state`,
  `.title`, `.strip`, `.dots` using existing tokens only.
  `ProjectPage.tsx` passes the project's sessions to `Board`.
- [x] Run `npm run typecheck`
- [x] Run `npm test`
- [x] Run `npm run build`

Manual check (human): cards show state, title, parent tag and session dots;
a feature with a waiting linked session turns amber with "Input required";
clicking still opens the feature, and the parent tag the parent.

## Slice 4 — `CONTEXT.md`

Context (code at `c31e824`): `CONTEXT.md` still describes the Board as a
content-area view of `kind: feature` cards, group features as collapsible
sidebar headers, and project folders as "the sidebar". The file's whole Terms
list is uncommitted human work, so this slice edits it in place and leaves it
uncommitted.

- [x] `CONTEXT.md`: update **Project**, **Group feature**, **Project folder**,
  **Feature page**, **Board**; add **Projects tab**, **Focus**,
  **Project page**, **Breadcrumb** (ADR 0018).
- [x] Run `npm run typecheck`
- [x] Run `npm test`
- [x] Run `npm run build`

## Open questions
