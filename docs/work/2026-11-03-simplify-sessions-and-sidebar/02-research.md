---
feature: 2026-11-03-simplify-sessions-and-sidebar
phase: research
status: approved
version: 1
created: 2026-11-03
updated: 2026-11-03
approved_at: 2026-11-03
based_on: []
forced: []
repo_heads:
  - 654ece6a4c147f8bd0adf5aa9570dbaeb79a7f24
---

# Research: code map

Commands: `npm test` (vitest, node env, no DOM tests), `npm run typecheck` (node + web), `npm run build`. Facts only; unverified items are marked.

## A. Removal surface

### Zones (about 650 LOC, plus about 120 lines of Sidebar edits)
- Shared: `src/shared/zones.ts` (+test), `types.ts` `Zone`, `Session.zoneOverride` (persisted), transient `Session.zone`, `UiState.sidebarView`; `shared/cli.ts` `zone?`; `shared/ipc.ts` channel `session:setZone`.
- Core/main: `core.ts` `withZones`, `sessionSetZone`, strip of `zone` before save (l.275); `main/ipc.ts:55`; `cliServer.ts:33` emits `zone` in `grove list`.
- Renderer: `zoneList.ts` (zone parts: `zoneSections`, `RECENT_COUNT`, `zonesFor`; `rowTitle`/`rowLine` are shared), `ZoneSection.tsx` + CSS, `Sidebar.tsx` (ZONE_CHOICES, Zones|Projects toggle, "Move to zone"/"Reset zone" menu items, cmd+. and cmd+1..9 ordering uses the zone order in zones view).
- Tests: `zones.test.ts`, `zoneList.test.ts` (delete); `core/sessions.test.ts:655-660`, `sessionStatus.test.ts:220-226` (edit).
- Other features do not depend on `zone`: counts, popups and cmd+. already ignore it. `zoneOf` only reads attention fields.
- Persisted: `zoneOverride` in state is dead and safely ignored; `sidebarView` in `ui.json` becomes an unknown key (how load handles unknown keys: unverified).
- No ADR or CONTEXT.md term covers zones.

### Boards (about 400 LOC for features+sessions boards; about 950 with the artifacts board)
- `ProjectPage.tsx` switches `Board` / `SessionsBoard` / `ArtifactsBoard`+`ArtifactPage`; `shell/BoardSwitch.tsx`; `Board.tsx`, `SessionsBoard.tsx`, `ArtifactsBoard.tsx`, `artifactsBoard.ts`, `ArtifactCard.tsx`, `featureUnion.ts`, `tags.ts`, `tree.ts` (`boardColumns`, `sessionColumns`).
- Wiring: `UiState.board` and `UiState.artifacts`; menu items "Project Board" (cmd+shift+B), "Artifacts" (cmd+shift+A) in `main/menu.ts:65-66`; `navigation.ts` (`openBoard`, `boardKey`, `artifactsKey`, crumbs); `stores/slices.ts`; `App.tsx` `BoardSwitch`; `paletteItems.ts:33-34`; README mentions at l.8, 31, 99, 112.
- Shared with other code: `ArtifactPage.tsx` imports `commentCard`/`stepKey` from `artifactsBoard.ts`; `navigation.ts` crumbs use `openBoard`; artifacts focus is also used by session-to-feature link navigation.
- Today the project page defaults to the sessions board. Features are reachable only through the features board, a session's linked-feature tag, or crumbs; `FeaturePage` renders one feature. Artifacts are viewable full-page only through the artifacts board / `ArtifactPage` (the viewer and "Open review" are separate paths). Worktree project pages already show only the sessions board.
- Persisted: `board`, `artifacts` in `ui.json` become dead keys; `focusedProject` stays.
- Tests: `boardRender`, `projectPageRender`, `artifactsBoard`, `artifactCardRender`, `featureUnion`, `tree` (board parts), `tags`, `navigation`, `paletteItems`.
- ADRs: 0018 (project page replaces board mode), 0020, 0037, 0041 mention boards. CONTEXT.md "Board" l.143-153, project page l.127-130.

### Epic / group feature in the app (about 220 LOC incl. tests)
- `types.ts` `Feature.group`, `Feature.parent`, `progress`; `core/workflow/parse.ts` (`group`, `parent_field`), `derive.ts:86-113` (group completion and progress); `resources/workflow.yaml:10-12`; renderer `navigation.ts` `childrenOf`, `FeaturePage.tsx` Parent/Children, `tree.ts`, `Board.tsx` parentTag, `tags.ts` group colours.
- No `src/` file names an "epic" kind. The app only reads generic `kinds.values[*].group` and `parent_field`.
- Skill-level `kind: epic` (separate concept): documented in `resources/skills/grove-run/references/contract.md` and `gates.md`; `grove.config.json` limits `epicMaxOneWayDecisions`, `epicMaxChildren` (never read by `src/`); `AGENTS.md` epic gate. Only `grove` and `grove-run` skills live in `resources/skills`.
- ADRs: 0002 (declarative workflow contract, group kinds), 0018. CONTEXT.md "Group feature" l.28-29.
- Not epic (do not confuse): session `parentId`, `ParentPicker`, `ChildrenPopover`, `session:setParent`.
- Overlap: removing boards and epics together takes `tree.ts` `boardColumns`, `Board.tsx`, `featureUnion.ts`, `tags.ts`.

## B. Session relation model

- `Session.parentId?: string|null` (types.ts:52), persisted, one level deep. No relation kind exists; ADR 0042 says "grouping only, no behaviour hangs off it".
- Rules in `shared/sessionGroups.ts`: `leaderOf` (a session spawned by a child becomes its sibling), `resolveParent` (`no-parent`, `same-session`, `is-parent`), `withParent`, `canParent`, `orphanChildren` (called at `core.ts:829` on removal and in the v9→v10 migration).
- Persistence: `stateStore.ts` `schemaVersion` 10, pure step migrations; added optional fields get no migration, normalized at load (l.58-60). Live-only fields stripped on save (`core.ts:275`): `held`, `attention`, `progress`, `handled[]`, `zone`, `status`, `waitingFor`.
- Creation: `grove new --parent REF | --child` (mutually exclusive; `--child` = `$GROVE_SESSION_ID`), `--worktree` needs `--branch`, `--link` sets feature (`cli/args.ts`, `cli/index.ts:56`, `cliServer.ts:78-107`, `core.ts:1031-1042`). UI: `ParentPicker`, card menu "Set parent…/Clear parent".
- `grove-run` (`resources/skills/grove-run/SKILL.md:86-112`): each slice is `grove new <agent> --child [--worktree ...] --link <slug>`; parent uses `grove wait`, `grove escalate`, `grove progress` (`Session.progress`, `family.ts runProgress`).
- Agent subagents are not rows: `core/status.ts` `Tracker.children`/`busy` fold OpenCode/Copilot subagent events into the root's status.
- Code that branches on `Session.parentId`: `shared/attention.ts:8`, `shared/zones.ts:17`, `zoneList.ts`, `core.ts:577` (classifier roots only), `core.ts:691 settleHold`, `core.ts:729-731 notifyTransitions`, `core.ts:1397 sendToSession` (`holdSent`), `sessionList.ts:144 isChild`, `Sidebar.tsx:314 kidsOf`, `family.ts`, `parentOptions.ts`, `cliServer.ts:32`. `held`/`attention`/`handled` are keyed on the child's session id; hiding children as rows means the parent would have to surface that identity.

## C. Attention routing for children

- Hold: a child entering permission/question starts `startHold` if `escalateAfterSec` > 0 (default 60, `core.ts:166`); while held it shows as working and counts as not asking.
- Parent answers via `grove send --from` (sets `holdSent`); `settleHold` appends to `parent.handled[]`, rendered only in the zones "Running (handled)" view.
- `grove escalate` (`sessionEscalate`, core.ts:1205) ends the hold and sets `attention`; popup via `core.on('notify')` (`main/index.ts:129`), click focuses the child.
- Roll-up: `mostUrgent` (`sessionStatus.ts:46`) shows the most urgent child's dot on a collapsed parent's pill. The parent's own dot is its own status; child status is not rolled into it.
- Reaching a child today: popup click, its row, cmd+. (`longestWaiting`), cmd+K, cmd+shift+J (`familyJumpTarget`), SessionMeta chips, cmd+1..9 over `orderedSessions` (skips collapsed kids).

## D. Sidebar and grid today

- `Sidebar.tsx` (716 lines): zones|projects views; Projects view `listGroups` with `GROUP_BY_OPTIONS` Project | Workflow status | None (default project), `SORT_OPTIONS` (Custom, Last viewed, Created, Time in status). Collapse keys in `ui.collapsed`: `p:`, `w:`, `o:`, `k:<parent>`, `d:<parent>`.
- Children render nested under the parent (`cardList`, `.kids` rail padding-left 18px); two or more `workflowStatus==='done'` kids fold into one stack row. A parent with 2 running and 3 done kids shows: parent row, 2 full kid rows, 1 stack row, and a pill "5 children, 3 done" plus a RunProgress bar if set.
- A child is nested only if its parent is visible and is itself a root; otherwise it shows as a root.
- Grid (`SessionGrid.tsx`, max 9 panes) uses `SessionMeta` with parent/active-child chips and `ChildrenPopover` (fixed portal, min 260px, Esc and outside click close).
- Reusable overlay pieces: `ChildrenPopover`, `CommandPalette` (cmd+K), `LaunchPalette`, `ScratchpadOverlay`, `ContextMenu`, `ui/Modal`. A new overlay must be added to `overlayOpen` (`App.tsx:182`). `grove read` (`core.sessionRead` → `backend.capture`) can supply a child's screen text.

## E. Visual language (for mockups; `src/renderer/src/styles/tokens.css`)

- Dark only, macOS vibrancy glass. Surfaces: chrome `#0a0a0b`, panel `#121212`, card `#1f1f1f`, raised `#232324`, terminal `#1e1e2e` / fg `#cdd6f4`. Text `#fff` / `#b3b3b3` / `#5e5e66`. Borders: card `#292929`, glass `rgba(255,255,255,.09)`.
- Accent `#fb923c`; worktree `#a78bfa`; PR open `#5ee0a0`; danger `#f87171`.
- Status dots (7px in rows): running `#fb923c`, working `#5ee0a0`, waiting `#fbc024` (pulses), finished `#24d3ef`, idle/gone `#5e5e66`, failed `#f87171`. Card tones: selected `#342519`/`#fb923c`, waiting `#1d1b15`/`#604c1d`, finished `#141c1d`/`#1f545c`.
- Type: `'JetBrains Mono Variable', Menlo` everywhere; 9.5 / 10 / 11 / 12 / 13px. Radius card 5px, md 8px, panel 10px. Header 47px, sidebar 220px default and min.
- Row anatomy (`ui/SessionRow`): grid `16px | 1fr | 30px | 7px`, padding `7px 10px 7px 8px`; title 11px semibold (2-line clamp); mono 9.5px meta line (kids pill, progress, terminal icon, branch); time in status; status dot. Kids rail: 18px indent, 1px rule, 9px tick.
- Layout: flex column; body row gap 4px, padding `0 4px 4px`; glass panels sidebar | content | optional viewer, radius 10px. Header holds crumbs or `SessionMeta`.
- Icons: inline Lucide-style SVG in `ui/Icon.tsx`.

## F. Tests

Shared: `sessionGroups`, `attention`, `zones`. Renderer: `family`, `sessionList`, `sessionStatus`, `sessionMetaRender`, `parentOptions`, `zoneList`, `paletteItems`, `tree`, `noInlineStyles`. Core: `sessions`, `status`, `store/stateStore`, `sessionCreate`. CLI/server: `cliServer`, `cli/args`. `tokens.test.ts` keeps `tokens.css` in sync with `shared/theme.ts`.

## Open questions
