---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: plan
status: approved
version: 1
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

## Open questions
