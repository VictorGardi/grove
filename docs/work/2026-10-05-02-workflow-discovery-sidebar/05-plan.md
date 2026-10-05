---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: plan
status: approved
version: 5
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: workflow, discovery and sidebar

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Tracer: features from the bundled workflow, read once

Context for a cold reader: the core lives in `src/core/` (Electron-free,
tested with vitest in node), `src/core/core.ts` holds the slices
(`projects`, `sessions`, `ui`) and pushes each change to the renderer as
`state:<slice>` through `src/main/ipc.ts`. `set()` in `core.ts` persists
`projects` to config and everything else to state; `features` must not be
persisted (design "Call paths"). npm needs `npm_config_cache=$TMPDIR/npm-cache`
in this sandbox (the default cache has root-owned files).

The `Feature` type grows with the slices: this slice ships only the fields it
computes (`projectId, slug, path, title, kind, group, parent, flow, stages,
currentStage`; stage `state` is `complete | current | upcoming`). Slice 4
adds `unapproved`, `cardState`, `flags`, `warnings`, `artifacts`.

- [x] `npm install --save-exact yaml@2.9.1` (adds to `dependencies`).
- [x] Create `resources/workflow.yaml`: the epic's shape (epic `03-design.md`
  "`workflow.yaml` shape") with `discovery: { manifest: feature.md, root:
  { from_file: grove.config.json, key: artifactRoot, default: docs/work } }`;
  `kinds` (field `kind`, default `feature`, `parent_field: parent`; `epic`
  `{ group: true, stages: [questions, research, design, structure] }`,
  `feature` `{ stages: all }`); `flows` (field `flow`, default `full`; `full`
  and `standard` all, `small` `[questions, implementation]`); stages
  `questions` 01-questions.md, `research` 02-research.md (review
  02-research.html), `design` 03-design.md (review 03-design.html),
  `structure` 04-structure.md (review 04-structure.html), `implementation`
  06-implementation.md, each `complete_when: { field: status, equals:
  approved }`, labels capitalised; flag `{ id: stale, label: Stale, when:
  { field: status, equals: stale } }`; `actions` and `stage_actions` copied
  verbatim from the epic shape.
- [x] Write failing test `src/core/workflow/frontmatter.test.ts`: dates stay
  strings (`created: 2026-10-05` → `'2026-10-05'`), leading BOM and CRLF
  accepted, `...` closes a block, no opening line → `data {}` no error,
  unclosed block → `data {}` + error, YAML error → error, non-mapping
  (`- a`) → error, body is the text after the closing line.
- [x] Create `src/core/workflow/frontmatter.ts`:
  `export type Parsed = { data: Record<string, unknown>; body: string; error: string | null }`
  and `readFrontmatter(text): Parsed` — strip a leading `﻿`, split lines
  on `/\r?\n/`, first line must be `---` (else `{ data: {}, body: text, error: null }`),
  find the next line equal to `---` or `...` (none → error `unclosed frontmatter`),
  `YAML.parse(block, { schema: 'core' })` in try/catch (error message →
  `error`); `null` (empty block) → `{}`; a non-plain-object → error
  `frontmatter is not a mapping`.
- [x] Create `src/core/workflow/parse.ts`: exported types `Predicate`
  (`{ exists: true } | { field: string; equals: unknown } | { field: string; in: unknown[] } | { all_checked: string }`),
  `Stage { id; label; artifact; review?: string; complete_when: Predicate }`,
  `AxisValue { stages: 'all' | string[]; group?: boolean }`,
  `Axis { field; default; values: Record<string, AxisValue> }`,
  `Workflow { discovery: { manifest: string; root: { from_file?: string; key?: string; default: string } }; kinds: Axis & { parent_field?: string }; flows?: Axis; stages: Stage[]; flags: { id; label; when: Predicate }[]; actions: Record<string, unknown>; stage_actions: Record<string, string[]> }`;
  and `parseWorkflow(text)` → `YAML.parse(text, { schema: 'core' })`
  (`YAMLParseError` message → `{ ok: false, error }`), then shape-only checks
  (top level mapping; `discovery.manifest` string; `discovery.root.default`
  string; `kinds.field`/`default` strings and `values` mapping; `stages` a
  non-empty array of mappings with string `id`/`label`/`artifact` and a
  `complete_when` mapping); missing `flags`/`actions`/`stage_actions` default
  to `[]`/`{}`/`{}`. Full validation is slice 2.
- [x] Write failing test `src/core/workflow/derive.test.ts` (workflow built
  by `parseWorkflow` over `resources/workflow.yaml`, read with
  `fileURLToPath(new URL('../../../resources/workflow.yaml', import.meta.url))`;
  folders built inline as `FolderSnapshot` objects): kind ∩ flow (`epic` has
  4 stages, `small` feature has questions + implementation, epic with
  `flow: small` has only questions); missing flow → default `full` (5
  stages); first incomplete stage is `current`, earlier `complete`, later
  `upcoming`; all complete → `currentStage: null`; title from the first
  `# ` heading else the slug; `group`/`parent` from the kind and manifest.
- [x] Create `src/core/workflow/derive.ts`:
  `effectiveStages(wf, manifest: Record<string, unknown>): Stage[]` (kind
  value = `manifest[kinds.field]` if a string key of `kinds.values`, else
  `kinds.default`; same for `flows` when present; a stage is effective if
  both lists are `'all'` or contain its id; `stages` order);
  `isComplete(p: Predicate, folder: FolderSnapshot, artifact: string): boolean`
  (`exists` → artifact parsed in `folder.artifacts`; `equals` → `data[field] === equals`;
  `in` → `in.includes(data[field])`; `all_checked` → that file is in
  `folder.artifacts`, its body has at least one `- [x]` and no `- [x]`
  line-start checkbox); and
  `deriveFeatures(wf, folders: (FolderSnapshot & { projectId: string })[], _sessions: Session[]): Feature[]`
  (stage states from the first incomplete effective stage; `flow` = the raw
  manifest value if a string, else `null`; `parent` from
  `kinds.parent_field` if a string, else `null`; items sorted by
  `projectId` then `slug`).
- [x] Write failing test `src/core/discovery/folder.test.ts` (temp dirs via
  `fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))`): `readFolder` returns
  `null` without the manifest; parses stage artifacts that exist and only
  those; `files` excludes dot-files and directories, sorted. `resolveRoot`:
  `from_file` key used when present, `default` otherwise (file missing or
  key missing), relative to the project path; returns `null` when the
  directory doesn't exist. `listFolders(root)` returns non-dot
  subdirectories.
- [x] Create `src/core/discovery/folder.ts`:
  `interface FolderSnapshot { slug; path; manifest: Parsed; files: string[]; artifacts: Record<string, Parsed> }`;
  `resolveRoot(projectPath, d: Workflow['discovery']): string | null` (read
  `path.join(projectPath, root.from_file)` with `YAML.parse(..., { schema: 'core' })`
  — JSON is valid YAML — take `root.key` if a non-empty string, else
  `root.default`; `path.resolve(projectPath, rel)`; `null` unless it is a
  directory); `listFolders(root): string[]` (sorted non-dot dir names);
  `readFolder(dir, wf): FolderSnapshot | null` (manifest missing → `null`;
  `files` = sorted non-dot regular files; `artifacts` = each file among the
  stage `artifact`s and `all_checked` targets that exists, through
  `readFrontmatter`).
- [x] `src/shared/types.ts`: add `FeatureStage { id; label; artifact; review: string | null; state: 'complete' | 'current' | 'upcoming' }`,
  `Feature { projectId; slug; path; title; kind; group: boolean; parent: string | null; flow: string | null; stages: FeatureStage[]; currentStage: string | null }`,
  `FeaturesSlice { workflowError: string | null; stages: { id; label }[]; items: Feature[] }`,
  `EMPTY_FEATURES: FeaturesSlice = { workflowError: null, stages: [], items: [] }`;
  `Slices` gains `features: FeaturesSlice`.
- [x] `src/shared/ipc.ts`: `PushMap` gains `'state:features': FeaturesSlice`.
- [x] `src/core/core.ts`: `CoreOptions.workflowPath: string`; slices start
  with `features: EMPTY_FEATURES`; `set()` saves state only for `sessions`
  and `ui` (never `features`); new `refreshFeatures()` — if the workflow is
  loaded, for each project `resolveRoot` → `listFolders` → `readFolder`,
  then `set('features', { workflowError, stages: wf.stages.map(({id,label}) => ({id,label})), items: deriveFeatures(...) })`;
  in `start()` read `opts.workflowPath` (read/parse failure →
  `workflowError = '<path>: <message>'`, items `[]`) and call
  `refreshFeatures()` after loading config/state; also call it after
  `projectAdd` and `projectRemove`.
- [x] `src/core/testing/setup.ts`: pass `workflowPath` =
  `fileURLToPath(new URL('../../../resources/workflow.yaml', import.meta.url))`.
- [x] Write test `src/core/features.test.ts`: with `<dir>/docs/work/a/feature.md`
  and `01-questions.md` (`status: approved`) created before `start()`, the
  core's `features.items` has slug `a` with `currentStage: 'research'`, and
  `state.json` has no `features` key.
- [x] `src/main/index.ts`: pass `workflowPath: path.join(app.getAppPath(), 'resources', 'workflow.yaml')`.
- [x] `src/renderer/src/stores/slices.ts`: `features: FeaturesSlice`
  (default `EMPTY_FEATURES`), subscribe `state:features`.
- [x] `src/renderer/src/components/Sidebar.tsx`: under each expanded
  project, before its session cards, one `ListRow` per feature of that
  project (`title` = feature title, `icon` `folder` 14,
  `meta` = the current stage's label or `Done`); class from
  `Sidebar.module.css` only (no inline styles).
- [x] Run `npm test` (outside the sandbox if the real-tmux tests fail with
  `posix_spawnp failed`), `npm run typecheck`, `npm run build`.
- [x] Manual in `npm run dev` (human): register this repo; the epic and its
  children show stages; visual-foundation shows `implementation`.

## Slice 2 — Live discovery and a guarded workflow

Context for a cold reader: slice 1 reads every project's feature folders
once (`refreshFeatures()` in `src/core/core.ts`, at start and after project
add/remove) from the bundled `resources/workflow.yaml`
(`CoreOptions.workflowPath`). This slice keeps one cached `FolderSnapshot`
map per project, updated by watchers, and adds full workflow validation.
Verified before planning: `require('chokidar')` (5.0.0, ESM-only) works in
Electron 44's main (`ELECTRON_RUN_AS_NODE=1 electron -e "require('chokidar')"`
→ Node 24.21), so chokidar stays an externalized `dependency` (no bundling
fallback). In the Claude Code sandbox `fs.watch` succeeds but then emits
`EMFILE` asynchronously; real-watcher tests must detect that and skip.
chokidar watches a not-yet-existing file path (emits `add` when it appears).

Watchers are injected into core like the session backend, so core tests
drive events by hand: a `Watchers` interface with a chokidar implementation
and a fake in `src/core/testing/`.

- [x] `npm install --save-exact chokidar@5.0.0` (with
  `npm_config_cache=$TMPDIR/npm-cache`); restore `package.json`'s one-line
  `build` key if npm reformats it.
- [x] Write failing test `src/core/workflow/parse.test.ts`: the bundled
  `resources/workflow.yaml` is valid; each of these yields
  `{ ok: false }` with an error containing the given path and text —
  unknown stage id in a kind (`kinds.values.epic.stages: unknown stage "nope"`),
  in a flow (`flows.values.small.stages: unknown stage "nope"`), unknown
  predicate (`stages[0].complete_when: unknown predicate`), `{repo}` in an
  action prompt (`actions.start.prompt: {repo} is reserved`), `per_repo` on a
  stage (`stages[0].per_repo: reserved`), unknown template variable
  (`actions.start.prompt: unknown variable {nope}`), duplicate stage id,
  `kinds.default` not in `values`, `stage_actions` naming an unknown
  action, unknown top-level key; a YAML syntax error yields an error
  containing `line 2, column 1`. Each case is built by editing the parsed
  bundled YAML (`YAML.parse` → mutate → `YAML.stringify` → `parseWorkflow`).
- [x] `src/core/workflow/parse.ts`: replace `shapeError` with
  `validate(w): string[]` collecting `path: message` errors; `parseWorkflow`
  returns `{ ok: false, error: errors.join('; ') }` when any, and for a
  YAML error the message's first line (it carries `at line L, column C`).
  Rules:
  - top level: a mapping; keys only `discovery kinds flows stages flags actions stage_actions` (else `<key>: unknown key`).
  - `discovery.manifest` string; `discovery.root.default` string;
    `discovery.root.from_file` and `.key` both strings or both absent.
  - `stages`: non-empty list; each a mapping with keys only
    `id label artifact review complete_when` (`per_repo` →
    `stages[i].per_repo: reserved for a later hub`, others unknown key);
    string `id` (unique: `stages[i].id: duplicate "x"`), `label`,
    `artifact`; optional string `review`; valid predicate.
  - predicate (mapping with exactly one of these shapes, else
    `<path>: unknown predicate`): `{ exists: true }`; `{ field: string, equals: string|number|boolean }`;
    `{ field: string, in: list }`; `{ all_checked: string }`.
  - `kinds`: string `field`; `default` a key of `values`; optional string
    `parent_field`; `values` a non-empty mapping of `{ stages: 'all' | list of known stage ids, group?: boolean }`.
    `flows` optional; same rules without `parent_field`/`group`.
  - `flags` optional list of `{ id: string, label: string, when: predicate }`.
  - `actions` optional mapping of `{ label: string, prompt: string, cwd?: string, needs_input?: boolean }`;
    in `label`, `prompt`, `cwd` every `{name}` must be one of
    `slug stage project_path feature_path feedback`; `repo`/`repo_path` →
    `<path>: {repo} is reserved for a later hub`; others →
    `<path>: unknown variable {name}`.
  - `stage_actions` optional mapping whose keys are `default` or a stage id,
    each a list of known action ids.
- [x] Write failing test `src/core/discovery/watcher.test.ts`, wrapped in
  `describe.skipIf(!(await canWatch()))` where `canWatch()` opens
  `fs.watch` on a temp dir and resolves `false` if it emits `error` within
  100 ms: `chokidarWatchers.watchRoot(root, onFolder)` reports `a` after
  `mkdir a` + `feature.md`; after renaming `a` → `b` reports both; after
  `rm -r b` reports `b`; writing `a/x.tmp` or `.dot/feature.md` reports
  nothing (poll up to 3 s for expected calls, wait 800 ms for
  "nothing"); `watchFile(file, cb)` fires when a missing file is created.
- [x] Create `src/core/discovery/watcher.ts`:
  `export interface Closer { close(): Promise<void> }`;
  `export interface Watchers { watchRoot(root: string, onFolder: (slug: string) => void): Closer; watchFile(file: string, onChange: () => void): Closer }`;
  `export const chokidarWatchers: Watchers` — `watchRoot` uses
  `watch(root, { ignoreInitial: true, depth: 1, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }, ignored })`
  where `ignored(p)` is true when any segment of `path.relative(root, p)`
  starts with `.` or `p` ends with `.tmp`; on `all`, the slug is the first
  segment of the relative path (skip `''`), coalesced per slug with a 50 ms
  timer, then `onFolder(slug)`; `close()` clears timers and closes.
  `watchFile` uses `watch(file, { ignoreInitial: true, awaitWriteFinish: {…same} })`
  and calls `onChange` on `all`. Both log `error` events with
  `console.warn('watch <path>:', err.message)`.
- [x] Create `src/core/testing/fakeWatchers.ts`: `class FakeWatchers implements Watchers`
  with `roots = new Map<string, (slug: string) => void>()` and
  `files = new Map<string, () => void>()`, filled by `watchRoot`/`watchFile`
  and deleted by the returned `close()`.
- [x] `src/shared/types.ts`: `ConfigFile` gains `workflow?: string`.
- [x] Write test `src/core/store/configStore.test.ts` — `saveConfig` then `loadConfig`
  round-trips `{ schemaVersion: 1, projects: [], workflow: '~/w.yaml' }`.
- [x] `src/core/core.ts`:
  - `CoreOptions`: rename `workflowPath` → `bundledWorkflowPath`; add
    `watchers?: Watchers` (default `chokidarWatchers`). Update
    `src/main/index.ts` and `src/core/testing/setup.ts` (setup passes a
    `FakeWatchers`, returned from `setupCore()` as `watchers`).
  - On start, keep `configWorkflow = loadConfig(...).workflow`; `set('projects')`
    saves `{ schemaVersion: 1, projects, ...(configWorkflow !== undefined && { workflow: configWorkflow }) }`.
  - `workflowFile()`: `configWorkflow` unset → `bundledWorkflowPath`;
    `~/x` → `path.join(os.homedir(), 'x')`; else must be absolute, otherwise
    `workflowError = 'config.json workflow: expected an absolute path or ~/…'`
    and no workflow is loaded.
  - `loadWorkflow()`: read + `parseWorkflow`; valid → `workflow = res.workflow`,
    `workflowError = null`; invalid or unreadable → `workflowError = '<file>: <message>'`,
    `workflow` unchanged (last valid; `null` at startup, so no features and
    no fallback to the bundled file).
  - Per-project cache `discovery = new Map<string, { root: string | null; fromFile: string | null; folders: Map<string, FolderSnapshot>; rootWatch?: Closer; fileWatch?: Closer }>()`.
  - `syncProject(p, force)`: with `workflow` set, `root = resolveRoot(p.path, wf.discovery)`;
    `fromFile = from_file ? path.join(p.path, from_file) : null`; if
    `fromFile` changed, close/replace `fileWatch` (`watchFile(fromFile, () => { syncProject(p, false); publish() })`);
    if `force` or `root` changed: close `rootWatch`, re-read all folders
    (`listFolders`/`readFolder`) into `folders` (empty when `root` null) and,
    when `root` is set, `rootWatch = watchRoot(root, (slug) => rereadFolder(p.id, slug))`.
  - `syncProjects(force)`: `syncProject` for every project; close and delete
    entries of removed projects; then `publish()`.
  - `rereadFolder(projectId, slug)`: `readFolder(path.join(root, slug), wf)`;
    set or delete in `folders`; `publish()`.
  - `publish()`: replaces `refreshFeatures()`; `workflow` null →
    `set('features', { ...EMPTY_FEATURES, workflowError })`; else derive from
    every cached folder (tagged with `projectId`).
  - `start()`: `loadWorkflow()`, `syncProjects(true)`, and
    `workflowWatch = watchFile(workflowFile, () => { loadWorkflow(); syncProjects(true) })`
    (skipped when the path was rejected). The 5 s poll also calls
    `syncProjects(false)`, so a root that appears later is picked up.
    `projectAdd`/`projectRemove` call `syncProjects(false)`.
  - `dispose()`: close every watcher (`void closer.close()`).
- [x] Write test `src/core/features.test.ts` additions (fake watchers):
  `config.json` `workflow` (a temp copy of the bundled file) is used and
  survives `projectAdd`; breaking it and firing its `files` callback sets
  `workflowError` and keeps the items; fixing it clears the error; a broken
  custom workflow at start → no items, error set; a new folder plus
  firing `roots.get(root)!('b')` adds `b`; rewriting `grove.config.json`'s
  `artifactRoot` and firing its `files` callback re-roots (items from the
  new root only).
- [x] `src/renderer/src/App.tsx`: banners = existing errors plus, when
  `features.workflowError` is set, `<Banner key="workflow">Workflow: {features.workflowError}</Banner>`.
- [x] Run `npm test` (outside the sandbox if the real-tmux tests fail to
  reach their socket), `npm run typecheck`, `npm run build`.
- [x] Manual in `npm run dev` (human): `mkdir` a folder with `feature.md`
  under `docs/work` → it appears; set `workflow` in
  `~/.config/grove/config.json` to a copy of `resources/workflow.yaml`,
  restart, break it → banner, features stay; fix it → banner clears.

## Slice 3 — The tree

Context for a cold reader: the core pushes `features` (`FeaturesSlice`, see
`src/shared/types.ts`) and `sessions` to the renderer store
(`src/renderer/src/stores/slices.ts`). Today `Sidebar.tsx` lists, per
project, flat feature rows and then the project's sessions
(`sessionsOf` in `src/renderer/src/sidebarOrder.ts`), with project collapse
kept in React state; `App.tsx` maps Cmd+N (`menu:action` `focusIndex`) through
`sidebarOrder()`. `Session.feature` is a slug in the session's project (or
`null`); nothing sets it until slice 5, so tests set it directly.
A done feature has `currentStage: null`.

Tree rules (design "Tree ordering", "Cmd+1..9", Desired state 4):
- Projects in config order. Under a project: its top-level features, then
  its unlinked sessions.
- A feature nests under the feature named by its `parent` when that slug
  exists in the same project; otherwise it is top-level.
- Under a feature: its linked sessions, then its child features.
- Features within one parent sort by slug with done ones after active ones;
  sessions sort by `startedAt`.
- A session whose `feature` names no feature in its project is unlinked.
- `collapsed` hides children in rendering only; `treeSessionOrder` walks
  every node, collapsed included. Features are not Cmd+N targets.

- [x] Write failing test `src/renderer/src/tree.test.ts` (plain objects for
  `Project`, `Feature` and `Session`; `Session` via a local helper with
  every field): child grouped under its epic by `parent`; a `parent` that
  doesn't exist → top-level; done features after active ones, both by
  slug; a linked session under its feature, before child features; a link
  to a missing slug → unlinked under the project, after features; another
  project's same-slug feature doesn't capture the session; `collapsed`
  keys `p:<projectId>` and `f:<projectId>/<slug>` set `collapsed: true`;
  `treeSessionOrder` returns sessions depth-first in display order,
  including those under collapsed nodes.
- [x] Create `src/renderer/src/tree.ts`:
  `export type TreeNode = { type: 'project'; key: string; project: Project; collapsed: boolean; children: TreeNode[] } | { type: 'feature'; key: string; feature: Feature; collapsed: boolean; children: TreeNode[] } | { type: 'session'; key: string; session: Session }`;
  `export const projectKey = (id: string) => 'p:' + id`;
  `export const featureKey = (f: Feature) => 'f:' + f.projectId + '/' + f.slug`;
  `buildTree(projects: Project[], features: Feature[], sessions: Session[], ui: Pick<UiState, 'collapsed'>): TreeNode[]`
  and `treeSessionOrder(tree: TreeNode[]): Session[]` per the rules above
  (session node key `s:<id>`).
- [x] Delete `src/renderer/src/sidebarOrder.ts`.
- [x] `src/shared/types.ts`: `UiState` gains `view: 'list' | 'board'` and
  `collapsed: string[]`; `DEFAULT_UI` gains `view: 'list', collapsed: []`.
- [x] `src/core/store/stateStore.ts`: `ui: { ...DEFAULT_UI, ...s.ui }`
  (missing fields default). In `src/core/store/stateStore.test.ts`: the
  round-trip fixture's `ui` gains `view: 'list', collapsed: ['p:x']`; add
  "an old ui without view/collapsed loads with defaults"
  (`{"schemaVersion":1,"sessions":[],"ui":{"sidebarWidth":300,"focusedSessionId":null}}`
  → `{ ...DEFAULT_UI, sidebarWidth: 300 }`).
- [x] `src/renderer/src/stores/slices.ts`: add
  `toggleCollapsed(key: string)` → `ui:set { collapsed }` with the key
  added or removed from the current `ui.collapsed`.
- [x] `src/renderer/src/components/Sidebar.tsx`: build
  `buildTree(projects, features.items, sessions, ui)` and render it
  recursively:
  - project node: the existing folder row (chevron by `collapsed`, name,
    remove and new-session actions, refused message); clicking it calls
    `toggleCollapsed(node.key)` (replaces the local `collapsed` state).
  - feature node: `ListRow` with `title`, `meta` = current stage label or
    `Done`, `icon` = a chevron button (only when it has children;
    `chevron-right`/`chevron-down` by `collapsed`, `onClick` stops
    propagation and calls `toggleCollapsed(node.key)`) followed by the
    `folder` icon; no row `onClick` yet (slice 4).
  - session node: the existing `SessionCard`.
  - children of a feature render inside `<div className={css.children}>`
    unless collapsed; add `.children` to `Sidebar.module.css`
    (`display: flex; flex-direction: column; gap: var(--sp-2); padding-left: var(--sp-3);`)
    and a `.chevron` class for the button (`display: flex; padding: 0; background: none; border: none; color: inherit; cursor: pointer;`).
- [x] `src/renderer/src/App.tsx`: `focusIndex` target =
  `treeSessionOrder(buildTree(projects, features.items, sessions, ui))[a.n - 1]`
  (read `features` from `useSlices.getState()` too).
- [x] Run `npm test` (outside the sandbox for the real-tmux and watcher
  tests), `npm run typecheck`, `npm run build`.
- [x] Manual in `npm run dev` (human): collapse the epic, restart, still
  collapsed; Cmd+2 focuses the second session in tree order.

## Slice 4 — Feature page

Context for a cold reader: `deriveFeatures` (`src/core/workflow/derive.ts`)
today marks the first incomplete effective stage `current`, earlier ones
`complete`, later ones `upcoming`. `Feature` (`src/shared/types.ts`) has no
card state, flags, warnings or artifacts yet. The sidebar
(`src/renderer/src/components/Sidebar.tsx`) renders feature rows from
`buildTree` with no click action; `App.tsx` shows the focused session.
`FolderSnapshot` (`src/core/discovery/folder.ts`) has `files` (top-level
non-dot files, sorted), `manifest` and `artifacts` (parsed stage files,
each `{ data, body, error }`). Styles go in CSS modules using
`src/renderer/src/styles/tokens.css` variables; inline `style=` is
rejected by `noInlineStyles.test.ts`.

Derivation rules (epic design "`workflow.yaml` shape", ADR 0002), over
effective stages in order:
- complete: `complete_when` holds → `complete`.
- otherwise, if any later effective stage's artifact is in
  `folder.artifacts` → `unapproved` (passed).
- the first stage that is neither → `current`; later ones `upcoming`.
- `currentStage` is that stage's id, or `null` when there is none.
- `cardState` (`running` and `waiting` come in slice 5 / child 3):
  `currentStage === null` → `done`; else no effective stage's artifact in
  `folder.artifacts` → `backlog`; else the current stage's artifact in
  `folder.artifacts` → `needs-review`; else `ready`.
- `flags`: each workflow flag whose `when` holds (`isComplete(when, folder, stage.artifact)`)
  for any effective stage, as `{ id, label }`, in workflow order.
- `warnings`: `flow?` when the manifest's flow field is a string not in
  `flows.values`; `kind?` likewise for the kind field; `frontmatter?: <file>`
  for the manifest and each entry of `folder.artifacts` whose `error` is
  set (manifest first, then artifacts by file name).
- `artifacts`: one entry per `folder.files` name, in order;
  `stage`/`role` = the effective stage whose `artifact` (`'artifact'`) or
  `review` (`'review'`) equals the name, else `null`/`null`.

- [x] `src/shared/types.ts`: `FeatureStage.state` adds `'unapproved'`;
  `export type CardState = 'backlog' | 'running' | 'waiting' | 'needs-review' | 'ready' | 'done'`;
  `Feature` gains `cardState: CardState`, `flags: { id: string; label: string }[]`,
  `warnings: string[]`, `artifacts: { name: string; stage: string | null; role: 'artifact' | 'review' | null }[]`;
  `UiState` gains `focusedFeature: { projectId: string; slug: string } | null`
  (`DEFAULT_UI`: `null`).
- [x] Write failing tests in `src/core/workflow/derive.test.ts`: an
  unapproved pass (01 `draft`, 02 approved → questions `unapproved`,
  current `design`); a `small` feature's timeline has no research, design
  or structure even with `02-research.md` present, and that file is not an
  unapproved pass; `stale` flag from `status: stale` on any stage
  artifact; `flow?` warning for `flow: weird` (stages = default `full`);
  `frontmatter?: 01-questions.md` for an unclosed block; card states
  `backlog` (manifest only), `ready` (01 approved, no 02),
  `needs-review` (02 present, draft), `done` (all approved, and also when
  the only incomplete stages are unapproved passes); `artifacts` tags
  `02-research.md` (`research`, `artifact`), `02-research.html`
  (`research`, `review`) and `notes.md` (`null`, `null`).
- [x] `src/core/workflow/derive.ts`: implement the rules above inside
  `deriveFeatures`; add `axisWarning(axis, manifest, name)` returning
  `name + '?'` for a string value not in `values`.
- [x] Write failing test in `src/core/features.test.ts`: `uiSet({ focusedFeature: { projectId: 'p', slug: 'a' } })`
  after `uiSet({ focusedSessionId: 'x' })` leaves `focusedSessionId: null`;
  then `uiSet({ focusedSessionId: 'y' })` leaves `focusedFeature: null`.
- [x] `src/core/core.ts` `uiSet`: merge, then if `partial.focusedFeature`
  is non-null set `focusedSessionId: null`; if `partial.focusedSessionId`
  is non-null set `focusedFeature: null`.
- [x] `src/renderer/src/stores/slices.ts`: `focusFeature(ref: { projectId: string; slug: string })`
  → `ui:set { focusedFeature: ref }`.
- [x] Create `src/renderer/src/featureLabels.ts`:
  `CARD_STATE_LABELS: Record<CardState, string>` (`Backlog`, `Running`,
  `Waiting`, `Needs review`, `Ready`, `Done`) and
  `featureSummary(f: Feature): string` = `Done` when `currentStage` is
  `null`, else `<current stage label> · <card state label>`.
- [x] `src/renderer/src/components/Sidebar.tsx`: feature rows get
  `meta={featureSummary(f)}`, `onClick={() => focusFeature({ projectId, slug })}`
  and `tone="selected"` when it matches `ui.focusedFeature`.
- [x] Create `src/renderer/src/components/FeaturePage.tsx` +
  `FeaturePage.module.css`: props `{ feature: Feature; sessions: Session[]; onFocusSession(id: string): void }`;
  sections:
  - header: title, `slug · kind · flow` (flow `default` when `null`),
    `Badge` with the card state label, a `Badge tone="muted"` per flag,
    warnings as a `.warning` line (`var(--danger)`).
  - "Stages": an ordered list, one row per `feature.stages` entry with a
    dot and the label, class by state: `complete` (`--status-finished`),
    `current` (`--accent`, bold), `unapproved` (`--status-waiting`, with
    the text "unapproved"), `upcoming` (`--text-3`).
  - "Files": one row per `feature.artifacts` entry: name, plus the stage
    id and `review` in `--text-3` when tagged.
  - "Sessions": sessions with `projectId === feature.projectId` and
    `feature === feature.slug`, each a `ListRow` (label, status) calling
    `onFocusSession`; "No linked sessions" when empty.
- [x] `src/renderer/src/App.tsx`: `focusedFeature` = the item matching
  `ui.focusedFeature`; when set, crumbs `[project name, feature title]` and
  content `<FeaturePage feature sessions onFocusSession={setFocused} />`;
  otherwise the current session content.
- [x] Run `npm test` (outside the sandbox for the real-tmux and watcher
  tests), `npm run typecheck`, `npm run build`.
- [x] Manual in `npm run dev` (human): open the epic's page and
  visual-foundation's page.

## Slice 5 — Manual link

Context for a cold reader: `Session` (`src/shared/types.ts`) already has
`feature: string | null` and `linkPinned: boolean`, both always `null` /
`false` so far. `buildTree` (`src/renderer/src/tree.ts`) already nests a
session under the feature whose slug equals `session.feature` in the same
project, and shows a link to a missing slug as unlinked. Core
(`src/core/core.ts`) re-derives features (`publish()`) on workflow and
folder changes only; `deriveFeatures` (`src/core/workflow/derive.ts`)
ignores its `_sessions` argument. IPC commands follow the
`session:rename` pattern: `InvokeMap` in `src/shared/ipc.ts`, a
`handle(..., true)` line in `src/main/ipc.ts`, a `Commands` method in core
returning `Result`. Session cards are `SessionCard` in
`src/renderer/src/components/Sidebar.tsx`; modals use `ui/Modal`; styles go
in CSS modules (no inline `style=`).

Rules (design "Manual link", "`running` card state"; E-D6):
- `sessionLink({ id, feature })`: unknown session id → `not-found`;
  `feature` a string that is not the slug of a feature in
  `slices.features.items` with the session's `projectId` → `not-found`;
  otherwise the session gets `feature` (string or `null`) and
  `linkPinned: true`, is saved, and features re-derive.
- Features re-derive whenever the sessions slice is set.
- `cardState` order: `done` when there is no current stage; else
  `running` when any session with this feature's `projectId` and
  `feature === slug` has `lastStatus: 'running'`; else `backlog`,
  `needs-review`, `ready` as before.

- [x] Write failing tests in `src/core/workflow/derive.test.ts`: a feature
  with 01 approved and a linked `running` session (same `projectId`
  `'p'`, `feature: 'a'`) is `running`; the same with the session `gone`
  is `ready`; a linked running session in another project leaves it
  `ready`; a done feature with a linked running session stays `done`.
  Build sessions with `newSession` from `../sessions` plus overrides.
- [x] `src/core/workflow/derive.ts`: rename `_sessions` to `sessions`;
  compute `running = sessions.some((s) => s.projectId === f.projectId && s.feature === f.slug && s.lastStatus === 'running')`;
  `cardState` = `current < 0 ? 'done' : running ? 'running' : <existing backlog / needs-review / ready chain>`.
- [x] Write failing tests in `src/core/features.test.ts` (`describe('core features')`),
  using `createTerminal` from `./testing/setup`: with feature `a` on disk,
  `sessionLink({ id, feature: 'a' })` returns the session with
  `feature: 'a'`, `linkPinned: true`, and feature `a`'s `cardState` is
  `running`; a second core `make()` + `start()` on the same files still
  has the session linked; `sessionLink({ id, feature: null })` sets
  `feature: null`, `linkPinned: true`; `feature: 'nope'` → `{ ok: false, error: 'not-found' }`;
  unknown session id → `not-found`; a feature that exists only in another
  project → `not-found` (add a second project `q` with its own
  `docs/work/b/feature.md` via `saveConfig` before `make()`).
- [x] `src/core/sessions.ts`: add `export function link(s: Session, feature: string | null): Session { return { ...s, feature, linkPinned: true } }`.
- [x] `src/core/core.ts`: `Commands` gains
  `sessionLink(a: { id: string; feature: string | null }): Promise<Result<Session>>`;
  implement per the rules above with `findSession`, `link`,
  `replaceSession`. In `set`, after notifying listeners and saving, call
  `publish()` when `k === 'sessions'`.
- [x] `src/shared/types.ts`: update the `Session.feature` and
  `linkPinned` comments to `// linked feature slug in this project` and
  `// true once set by hand; auto-linking (child 3) leaves it alone`.
- [x] `src/shared/ipc.ts`: `InvokeMap` gains
  `'session:link': [{ id: string; feature: string | null }, Session]`.
  `src/main/ipc.ts`: `handle('session:link', (a) => core.commands.sessionLink(a), true)`.
- [x] `src/renderer/src/components/ui/Icon.tsx`: add `'link'` to
  `IconName` with Lucide's shape
  `<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>`.
- [x] Create `src/renderer/src/components/LinkPicker.tsx` +
  `LinkPicker.module.css`: props `{ session: Session; onClose(): void }`;
  reads `features` from `useSlices`; renders a `Modal` (`width="sm"`, no
  `onConfirm`) with a title "Link session", then one `ListRow` per
  feature with `projectId === session.projectId` (in `features.items`
  order, `title` = feature title, `meta` = slug, `tone="selected"` when
  `session.feature === slug`) and a final `ListRow` titled "None"
  (`tone="selected"` when `session.feature` is `null`). Clicking a row
  invokes `session:link { id: session.id, feature: slug | null }`; on
  `ok` call `onClose()`, otherwise show the error in a `.error` line
  (`var(--danger)`, `var(--fs-sm)`). The list scrolls (`.list`:
  `max-height: 50vh; overflow-y: auto`, flex column, `gap: var(--sp-1)`).
- [x] `src/renderer/src/components/Sidebar.tsx`: `SessionCard` gains an
  `onLink: () => void` prop and a first action
  `<Button variant="ghost" size="sm" round icon="link" aria-label="Link…" title="Link…" onClick={onLink} />`;
  `Sidebar` keeps `const [linking, setLinking] = useState<Session | null>(null)`,
  passes `onLink={() => setLinking(s)}`, and renders
  `{linking && <LinkPicker session={linking} onClose={() => setLinking(null)} />}`
  at the end of its root `div`.
- [x] Run `npm test` (outside the sandbox for the real-tmux and watcher
  tests), `npm run typecheck`, `npm run build`.
- [x] Manual in `npm run dev` (human): link a terminal to this feature; it
  moves under the feature and the feature reads `running`; restart; still
  linked; link it to None; it moves back to unlinked.

## Open questions
