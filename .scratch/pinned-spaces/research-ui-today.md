# Pinned spaces: how the UI behaves today

Facts only. Paths are under `/Users/victor/git/grove/packages/` (`ui/` = packages/ui). Line numbers as of master at fe348e2.

## 1. Sidebar tree

### Data
- `SpaceInfo` (protocol/messages.ts:212-225): `id, path, name, label, repoName, parent, worktree, branch`. No pin or order field. The core's saved record is `SpaceRecord { id?, path, name? }` (core/store/state.ts:9-13); no other per-space field exists. Spaces are an array in the state file; array order is the add order.
- Window store holds spaces in a `Map` (ui/window-store.ts:127); `store.spaces()` returns them in insertion order. `reconcile` clears and refills it from `spaces.list` (:396-398). `upsertSpace` re-sets by id (:418), `dropSpace` deletes (:422).
- Updates arrive as `spaces.changed` (SpaceInfo) and `spaces.removed` (ui/main.ts:1348-1351). The core broadcasts `spaces.changed` from a git poll when the JSON of the info changes (core/daemon.ts:205-216), after `setRoot` (:166-172) and after `worktrees.add` (:751, :764).

### Tree shape (ui/sidebar-model.ts)
- `sidebarItems(spaces)` (:68-96) returns `SidebarItem[]`: `{kind:'heading', repo, rows}` or `{kind:'plain', row}`. Items are in first-seen order of the spaces array: a heading is pushed when its first member is met (:78-83). Within a heading: main-checkout rows first, then worktree rows (:91-94), each group in array order.
- `repoOf` (:58-62): a worktree's repo is its `repoName`, else the parent's repoName/name. A non-worktree with no parent gives null.
- Main checkout detection (:69-86): a space is `main` if some listed worktree names it as `parent` (`mainRepo`), or it has `repoName` set (then a heading of one row). Anything else is `plain` (no repo).
- `rowName` (:99-102): main checkout shows `label ?? branch ?? name`; any other row shows `name`.
- Heading is keyed by repo name string (comment :46-48), not a space id.
- `repoColor(repo)` (:109-113): hash into 1..6; styles.css reads `--repo-1..6`.

### Render (ui/main.ts)
- `renderSidebar()` (:988-1024) rebuilds `#spaces` (`<ul id="spaces" class="spaces">`, index.html:~28) with `replaceChildren` on every paint. Order: each item as `<li>`; plain item = a `spaceRow` button; heading item = `<li class="heading" data-repo-color>` holding `headingEl` (`<h3 class="heading-name">`) and a `<ul class="spaces graph">` of `<li>` rows. Then the quiet toggle `<li><button class="spaces-quiet">` if any quiet (:1017-1022, quietToggle :1028).
- Quiet folding: `quietSpaces` (quiet-spaces.ts:37-54) + `foldQuiet` (sidebar-model.ts:132-136) drop quiet plain rows and all-quiet headings; `quietOpen` is memory-only (main.ts:121). A space is never quiet if active, a worktree of the active space, under the active heading, busy (working/needs-you/finished), or among the 5 most recently visited (`RECENT_SPACES`, quiet-spaces.ts:10). Quiet-fold has no notion of pin.
- Fold state: `folded` string[] of repo names (main.ts:119), persisted in localStorage key `grove.sidebar-folds` (sidebar-state.ts:15-29; JSON array of strings; non-listed repos are dropped on write). `headingOpen(repo, folded, activeRepo)` (sidebar-model.ts:116-118): open unless folded, except the active space's heading always draws open. `toggleFold` (main.ts:1041-1045). Plain rows have no fold.
- Heading element (`headingEl`, main.ts:1048-1068): `h3.heading-name`, `tabindex 0`, `role=button`, `aria-expanded`; child `span.heading-label` with the repo name; while folded, the most urgent state of its rows as an indicator. Click/Enter/Space folds. Right-click opens the space menu with `heading=true` using `item.rows[0].space`. No chevron or icon is drawn on a heading today.
- Row element (`spaceRow`, main.ts:1107-1146): `button.space.state-<x>`, `data-space-id`, `title=space.path`. Plain row with no tabs: `node + span.space-name + span.space-branch` (class `plain`, 3-column grid). Otherwise `node + span.space-line` containing name, `openLine` (agent/terminal counts, or "No tabs open"), and time (only for needs-you/working/finished). Active row gets `aria-current="true"` (:1130) (styled `background: var(--color-selected)`, styles.css:289). Click: `selectSpace(space.id, chosen)` then `focusActive()`; `chosen` is the deciding tab only when state is needs-you/finished, else the space's last visited tab (store decides).
- Row node (`spaceNode`, :1081-1087): indicator of the most urgent state, or a dashed `unknown` indicator titled "no tabs open".
- Headings have no per-repo menu other than worktree actions; no row shows a pin, star or ordering number.

### Context menu (main.ts:656-669, `openSpaceMenu(space, event, heading=false)`)
- Items for a space row: `Rename` (edit icon) -> `askRenameSpace`; `New worktree` (branch icon); `Open worktree` (branch icon); `Close` (x icon, `separated: true`) -> `askRemoveSpace`.
- Items for a heading: `New worktree`, `Open worktree` only (Rename and Close are left out).
- Menu is not installed in demo mode (`!demoMode`, :1062, :1143). Item shape: `{label, icon?, separated?, run}` (context-menu.ts:3-10). Icons come from `iconSvg(name)` in ui/icons.ts; names present include `search, sidebar, plus, grid, x, terminal, branch, edit, notes, diff, usage, check, chevron, expand, send, worktree`; there is no pin icon (icons.ts:10-25).

### Ordering and Cmd+1..9
- Cmd+1..9 are actions `space-1..space-9` (core/config/schema.ts:43-51; main.ts:374-382) -> `focusSpace(place)` (main.ts:1175-1180): `spaceAt(sidebarSpaceOrder(store.spaces()), place)`, then `selectSpace(id)` and `focusActive()`; a place past the last space does nothing.
- `sidebarSpaceOrder` (sidebar-model.ts:139-141) = ids of all rows of `sidebarItems`, flattened in draw order (heading rows, or the plain row). It includes rows hidden by a folded heading or the quiet fold. Test: "numbers every row, so a shortcut means the same space whether or not its heading is folded" (sidebar-model.test.ts:310).
- The place number is not drawn on rows. Shortcut labels come from the keys config (`shortcut(action)`, main.ts:919) and the keys panel.
- `dropSpace` of the active space selects `sidebarSpaceOrder(...)[0]` (window-store.ts:426). `reconcile` with no valid active space selects `state.spaces[0]` (store order, not sidebar order) (:413).
- Go to is fed `sidebarSpaceOrder(store.spaces())` mapped back to space fields (main.ts:195-198), so it inherits the sidebar order as its starting order and tie-break.

## 2. Go to

Files: ui/goto.ts (DOM), ui/goto-model.ts (rules), ui/quiet-spaces.ts. Opened by Cmd+K (`palette` action, main.ts:365) or the search button (:224).

### Input and fields
- `GoToSpace = SidebarSpace` (goto-model.ts:12): `id, parent, name, label, worktree, repoName, branch`. No other space data. Tabs: `id, spaceId, name, agent, state, since, reason, exited`.
- Source in main.ts:194-213.

### Order (`goToView`, goto-model.ts:193-298)
- No query: each space is an entry with `tier` (:268): 0 a tab needs you, 1 a tab finished, 2 the active space, 3 working, 4 the rest; sorted by `tier` then `latest` (most recent visit rank, from `visitRank` of the space's tabs) (:277); stable sort so equal ones keep sidebar order (:275). Quiet spaces are removed behind a count unless `expandQuiet` (:279-281).
- Heading grouping (:282-284): spaces of one repo are pulled together at the position of the repo's first space in that order; plain spaces stand alone.
- With a state-only query (`!`, `~`) the tree is kept; with words (`terms.length>0`) it goes flat: `results = {worktrees, tabs}`; worktrees ranked by score, then tier, then latest; tabs by score then rank (:286-293). Groups are still computed but not drawn.
- Within a space tabs are sorted by score, then (when not searching) urgency, then visit rank (:266).
- Tab rows highlight: the current tab when not searching, else first row (:295-296).

### What is drawn (goto.ts)
- Tree (`treeNodes`, :115-141): plain space -> `spaceNode(group)`; repo spaces -> `section.goto-heading[data-repo, data-repo-color]` with `h3.heading-name > span.heading-label` (repo name) and `ul.spaces.graph` of `li`s. No indicator or icon on the heading.
- `spaceNode` (:143-159): a space with exactly one tab is one row (`tabRow` with the space node, name = group.name). Otherwise `section.goto-group.state-*` with `header.goto-space` (node, `span.goto-space-name`, `span.goto-space-note` "No tabs open" / "N tabs") and its tab rows as `ul.spaces.graph`.
- Tab row (`tabRow`, :162-167): node, name, `span.goto-kind` (agent mark, or terminal `>_`, title the agent name or "Terminal"), time `span.goto-time` while busy.
- Result rows (`hitRow`, :195-215): indicator, `goto-hit-text` (highlighted name + `goto-hit-where` muted line: repo; for tabs "repo / space"), then either status text ("Working 3m", "Finished 1h ago"), or open counts (agent/terminal marks with counts) for worktree rows, or the kind mark for tab rows. Section titles `h3.goto-section`: "Worktrees", "Tabs"; "No matches" when empty (:189-193).
- Chips (needs you / working) with counts; count in field "N results"; quiet toggle `button.goto-quiet` ("N quiet spaces ▾" / "Hide quiet spaces ▴", quiet-spaces.ts:57-59).
- Marks drawn today: state indicator, repo colour on heading name and trunk (`--repo`), agent/terminal kind mark, time/status, open counts, highlight match `mark.goto-match`. No pin mark, no place number.
- Enter or click goes to the row's `tabId` (`choose`, :225-228); Cmd/Ctrl+Enter also puts it in the grid. A space row in results goes to its deciding tab.
- Search matches (`queryScore`, goto-model.ts:93-104): tab name, space name, repo name (for worktrees), agent name; space rows match `shown`, `space.name`, repo.

## 3. What the main window shows about the active space

- Window title: static. `<title>Grove</title>` (index.html:7); `tauri.conf.json` window `title: "Grove"`, `titleBarStyle: "Overlay"`, `hiddenTitle: true` (ui/src-tauri/tauri.conf.json:13-20), so no title text is visible in the title bar. No code calls `document.title` or `setTitle` (grep of ui/ finds none). The top left of the sidebar header shows the text "Grove" (`span.brand-name`, index.html:17).
- Tab strip (`.tabstrip`, `data-tauri-drag-region`, index.html:~35-52): sidebar-show button, `#tabs` (pills of the active space's tabs only: `tabEl.hidden = tab.spaceId !== activeSpace`, main.ts:895), then `.tab-actions` (launchers, dim slider, grid reset, grid toggle, dock toggles). Each pill (`tab-pill.ts:31-71`): `div.tab` > `button.tab-main` (agent/terminal mark, `span.tab-label` name, `span.tab-grid`, indicator) + `button.tab-close`. The pill has `title = "<space name>: <tab name>"` (`tabLabel`, main.ts:439-441, passed as `title`, :766). The strip shows no space name, repo or branch.
- Pane header (`header.pane-head`, built in `paintTab`, main.ts:758-785; one per tab, shown for the active tab or all grid members): in order `markEl(kind)`, `span.pane-kind` (tab name; class `unnamed` when no own name), `branchButton` (only if `space.branch`; class `worktree` makes the branch icon purple (`--color-worktree`); click copies the name), `span.pane-folder` (`shortFolder(spacePath, home)`), changes button (when +/- counts exist), context meter (agents), voice indicator, state indicator. Layout/flex in styles.css:1002-1075 (`pane-folder` has `flex: 1 100 auto` and takes the slack; the branch is `flex 0 1 auto`). The space's display name is not in the header; the folder path is.
- Pane headers repaint on every `paint()` (`paintTab` replaces children). The header is also the grid drag handle (`gridArranger.grab(head, ...)`, :470).
- Empty state (`#empty-state`, index.html:~55-58; `paintEmpty`, main.ts:873-882): shown when there is no active space ("No space open" / "Press <new-space key> to open a space at your home folder.") or the active space has no tabs ("No tabs in this space" / "Press + in the tab strip (<new-shell key>) to open a shell."). It does not name the space.
- Sidebar: active space row has `aria-current=true` and the selected background; the active heading is forced open. That is the only place the active space is marked.
- Status line (`statusLine`) and a footer banner (`#urgent-banner`) exist (main.ts:1290, paintUrgent :975); neither mentions the active space.
- Tests that read these: status-window.test.ts `indicatorsFor` reads `#tabs > *` and `#terminals .pane .pane-kind` and `.pane-head .indicator` (:~129-134).

## 4. Closing, removal, deleted worktrees, missing paths

### Close or remove a space (UI)
- Context menu `Close` -> `askRemoveSpace(space)` (main.ts:552-). Dialog: non-worktree "Remove <name>? The folder <path> is not touched. Its N tabs close."; worktree "Remove worktree <name>? This deletes the checkout at <path>. The branch stays. Git refuses if the checkout has changes." (:565-583). Calls `spaces.remove { id, removeWorktree: space.worktree }`, then `store.dropSpace(id)`.
- Git refused (`ERROR_CODES.gitRefused`): dialog closes, `askForceRemove` offers "Force remove" which sends `{removeWorktree:true, force:true}` (:552-573).
- Closing the last tab of a space asks to remove the space ("That was the last tab.", cancel label "Keep space") (`closeTab`, :541-550; `askRemoveSpaceOnce` `lead`, :576).
- Core `removeSpace` (core/daemon.ts:776-788): asserts state not refused and the space exists; with `removeWorktree` runs `removeWorktreeFolder` first (refused for main checkouts, for a folder another space also uses, and by git when changes/lock unless force; core/spaces.ts:171-188); then closes every tab of the space (`closeTab`); then `spaces.removeSpace(id)` filters the record out of the state file (core/spaces.ts:108-114) and broadcasts `spaces.removed { id }`. All other windows/CLI call `store.dropSpace(id)` (main.ts:1348).
- `dropSpace` in the store (window-store.ts:422-428): removes the space's tabs, its per-space recent list, the space itself; if it was active selects the first space in `sidebarSpaceOrder`, or null. Then `commit()`.
- What is kept when a space is removed: nothing about the space. `SpaceRecord` is deleted; the folder's `diffPrefs`/`diffComments` are keyed by folder path and are not removed (core/store/state.ts:28-33; no deletion in `removeSpace`). Window-local state keyed by repo name (`grove.sidebar-folds`) is pruned only when a repo no longer has a heading, at the next fold write (sidebar-state.ts:28-30). View state (`grove.view-state`: `activeSpace`, `activeTab`, grid tabs) is in localStorage and refers to ids; a saved id that no longer exists is ignored (window-store.ts:239-242, :413).
- Removing a worktree's checkout outside Grove (e.g. `git worktree remove`): the space record stays; `readGit` returns nulls when the folder is gone (`!fs.statSync(path).isDirectory()` -> `{repoName:null, mainPath:null, branch:null, linked:false}`, core/spaces.ts:485-492), so the next `describe` gives `repoName:null, worktree:false, parent:null, branch:null`; the git poll then broadcasts `spaces.changed` (daemon.ts:205-216) and the space becomes a plain row in the sidebar. Nothing removes it automatically.
- `spaces.removed` is also how the CLI's removals reach the window.

### Startup with a saved path that is missing
- `SpacesService` constructor loads the state file (core/spaces.ts:48-53). `loadState` (core/store/state.ts:93-134): missing file -> empty state; invalid JSON, non-object, or malformed spaces/tabs -> file renamed `<file>.corrupt-<ms>`, empty state; no `version` or version != 1 -> state refused (`refused` string, nothing written; `spaces.list` returns `refused`, UI shows "State file refused: ..." in the status line, main.ts:1290). Space path existence is not checked at load.
- Restore (`restore`, core/spaces.ts:241-268): shell tabs the holder does not know are recreated as login shells with `cwd: rootFor(space path ?? tab.spacePath)`; `rootFor` returns the path if it is a directory, else `os.homedir()`: "A space whose folder is gone restarts its shells in the home folder; the record is kept" (:537-541). Agent tabs are not restarted (resumed on request).
- `describe`/`readGit` for a missing folder gives the nulls above; space name is `space.name ?? path.basename(path)` (:505-518). So a space with a missing folder is still listed, named by its folder name or label, as a plain row (no branch, not a worktree).
- `spaces.add` rejects a non-absolute, non-existent or non-directory path (:85-99); `setRoot` returns false when the new folder does not resolve (:300-304).
- Window side: `resync` -> `store.reconcile` replaces spaces from `spaces.list`; saved `activeSpace`/`activeTab`/grid tabs from `grove.view-state` that are gone are dropped silently (window-store.ts:233-243).

## 5. Tests that constrain changes

Run with `npm test` and `npm run typecheck` (AGENTS.md).

### ui/literals.test.ts
- Scans every `.css`, `.ts`, `.tsx` under packages/ui except `*.test.ts`, `src-tauri`, `dist`, `node_modules`, `demo`, `src/tokens.css`, `src/themes.css` (:11-12, :17-30).
- Fails on a hex colour (`#` + 3/4/6/8 hex digits not followed by a name char), colour functions (`rgb( rgba( hsl( hsla( oklch( oklab( lab( lch(`), and any number with a unit `px|rem|em|pt|vh|vw|ms|s` except `1px`, `0s`, `0ms` (:15-20, :32-45). `%` and unitless numbers (SVG path data, `flex: 1 100 auto`) are allowed. `color-mix(... 70%, transparent)` is used in styles.css and passes.
- Also: `index.html` must contain no `style=` attribute and no `<style` element (:97-101). So new colours and sizes must be tokens in `src/tokens.css`/`themes.css` and referenced with `var(--...)`; new icons in icons.ts are SVG strings (numbers without units).

### ui/status-window.test.ts (happy-dom, drives main.ts through the bridge mock)
- Mocked `spaces.list` returns one space `{ id:'s1', path, name:'proj', repoName:null, parent:null, branch:null }` with no `label` or `worktree` fields (:30-33); `space()` helper adds `label:null, worktree:false` (:~144-146). So any new space field must be tolerated as absent/`undefined` in the main.ts path.
- Asserts that constrain the sidebar DOM: rows found by `#spaces .space[data-space-id]`; `.space-name`, `.space-time`, `.space-count` (+ aria-label), `.space-detail`, `.indicator` class names (:~130-146, test :281-). Row classes `state-working`, `state-needs-you`; text must not contain "Ready" (:~299).
- Heading test (:356): `#spaces .heading` list order `['proj','lone']`; `.heading-name` textContent equals the repo name exactly (an added icon with text would break the equality; an icon with no text would not); `heading-name` is not inside a button; `.space-name` lists per heading `['main','proj-wt']`; clicking the heading switches no space and keeps the `aria-current` row; after removals no `#spaces .heading` remains.
- Fold test (:378): `.heading-name .indicator` appears only while folded; `.graph` `hidden` flag; localStorage `grove.sidebar-folds` equals exact arrays (`['lone']`, `['lone','proj']`, `[]`); active heading stays open; Ctrl+`.` jumps to an urgent tab and opens the folded heading.
- Quiet test (:412): `listed()` = all `#spaces .space-name` texts in order (`['main','proj-wt']`, then with quiet open `['main','proj-wt','master','old-wt','lone']`); toggle text `'3 quiet spaces ▾'`, `'Hide quiet spaces ▴'`, `'1 quiet space ▾'`; `#spaces .spaces-quiet` is null when none. Any new group in `#spaces` that contains `.space-name` elements changes `listed()` order expectations.
- Go to test (:440): `#goto-list .goto-heading .heading-label` texts `['proj']`; `.goto-heading .goto-space-name` `['main','proj-wt']`; `.goto-heading .goto-space .indicator` class exactly `'indicator ind-needs-you'` with `aria-label 'needs you'`; `.goto-quiet` texts; flat results: `.goto-section` texts `['Worktrees']`, `.goto-hit .goto-row-name` `'main'`, `.goto-hit .goto-hit-where` `'proj'`, `#goto-count` `'1 result'`, `#goto-chip-needs` `'Needs you1'`, no `.goto-heading` while searching.
- :477 asserts `#spaces` has no `.agent-mark, .space-tile, #agents` and text does not match `/Claude|Copilot|OpenCode/`.
- Also covers startup restore of grid/selected tab from `VIEW_STATE_KEY` (:177), CLI-created spaces appearing immediately (:197), tab pill/pane indicators (`#tabs > *`, `#terminals .pane`, `.pane-kind`, `.pane-head .indicator`, :215-232).

### ui/sidebar-model.test.ts
- `sidebarItems` cases (:127-170): heading holds main checkout first then worktrees; worktree whose main is not a space gets a heading named for the repo; heading survives main checkout being added/removed; a repo with a single checkout gets a heading; a second space on one folder follows the first under the repo; a space git cannot place is plain; empty input gives `[]`.
- `sidebarSpaceOrder` (:196-213) and `spaceAt` (:215-224): order is heading rows or plain row in draw order, folded rows included; Cmd+digit test (:310-316) says numbering counts every row regardless of fold.
- `headingOpen` (:274-286), `headingOf` (:288-295), `foldQuiet` (:318-339: plain quiet space leaves; a heading only when all its rows are; count counts spaces), `rowName`, `repoColor` (same colour every time, within 1..6), `rowSummary`, `tabStateOf`, `urgentTabs`/`nextUrgent`/`jumpTargets`, `shortFolder`.

### ui/goto-model.test.ts
- Orders (:22-36, :103-117): spaces by recent use with the current space first; tier order needs-you, finished, current, working, rest; tabs that need you first inside a space.
- Quiet (:37-86): idle not-current spaces collapse behind a count; lists them after the others when expanded; none when all are current or busy.
- Filters (:130-166), query matching and ranking (:168-258), rows/groups (:260-363: `GoToRow` fields incl. `where`, `open`, `stateLabel`; a repo's spaces under one heading and named as the sidebar names them; `highlight` starts on the current tab or top match), tree (:383-400: `single`, `tabCount`, counts), results (:402-447), `unnamedTabName` (:454).
- These tests build `GoToSpace` inputs by hand; an added required field on `GoToSpace`/`SidebarSpace` would need adding there for typecheck.

### Others
- ui/quiet-spaces.test.ts (104 lines): quiet rules (current never quiet, busy never, 5 most recent kept, worktrees of current and spaces under the current heading never quiet, `heading` ignored when the list draws none).
- ui/sidebar-state.test.ts (57 lines): `grove.sidebar-hidden` flag; `grove.sidebar-folds` read/write: empty when nothing stored, round trip, ignores non-list data, drops repos that no longer have a heading.
- ui/window-store.test.ts and ui/view-state.test.ts exist for `reconcile`, `dropSpace`, `restoreViewState`.
- core tests that touch space persistence: core/store/state.test.ts, core/spaces.test.ts, spaces-writes.test.ts, spaces-refresh.test.ts, spaces-worktrees.test.ts, daemon.test.ts (`spaces.changed` at :150).

### Other facts that bear on a change
- The keys list for Cmd+1..9 and `palette` is in core/config/schema.ts:43-65 (actions), and the default bindings table is in the same area.
- Glossary: no entry for "pin" or "pinned" in GLOSSARY.md (grep found none).
- ui/design-notes.md exists (not read for this note).
