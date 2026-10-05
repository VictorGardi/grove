---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: implementation
status: draft
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@3
forced: []
---

# Implementation: workflow, discovery and sidebar

## Progress

- [x] Slice 1 — Tracer: features from the bundled workflow, read once
- [x] Slice 2 — Live discovery and a guarded workflow
- [x] Slice 3 — The tree
- [ ] Slice 4 — Feature page
- [ ] Slice 5 — Manual link
- [ ] Slice 6 — Board (appetite cut 1)

## Slice 1 — Tracer: features from the bundled workflow, read once

Verification: `npm test` 83/83 passed (run outside the Claude Code sandbox:
inside it the four real-tmux tests in `src/core/backend/tmux.test.ts` fail
to reach the tmux socket, unrelated to this change); `npm run typecheck`
clean; `npm run build` clean. Manual check passed (human, 2026-10-05): with
this repo registered, its features show under the project. They appeared
only after an app restart; the first run was from before this slice's build.

Probe over this repo's `docs/work` with the bundled workflow: both
`standard` children with approved 01–04 (this feature, visual-foundation)
read `implementation`; the epic, walking-skeleton and the backlog children
read `questions`. The epic and walking-skeleton have `01-questions.md` at
`status: draft` with approved later artifacts. Slice 4's "unapproved" rule
(a stage counts as passed if a later effective stage's artifact exists)
moves them forward. That matches the structure, which puts that rule in
slice 4.

Deviations (all small, two-way):

- `npm install` needs `npm_config_cache=$TMPDIR/npm-cache` in the sandbox
  (root-owned files in `~/.npm`). npm also reformatted `package.json`'s
  one-line `build` key; restored by hand so the diff only adds `yaml`.
- An unknown `kind` value falls back to `kinds.default`, like an unknown
  `flow` (E-D2). Neither gets a warning yet: `warnings` is slice 4.
- `flows` is optional in the `Workflow` type. Without it, the kind's stages
  apply unfiltered. Slice 2's validator keeps this.
- `all_checked` is true when the file exists, has at least one `- [x]` and
  no `- [ ]` (case-insensitive `x`). The bundled workflow doesn't use it
  (D4).
- `from_file` is parsed with `yaml` (JSON is valid YAML), so a YAML config
  file works too.
- An empty frontmatter block (`---` then `---`) is an empty mapping, not an
  error.
- Core re-reads features after `projectAdd` and `projectRemove` as well as
  at start, so a project registered while the app runs shows its features
  without a restart.
- The `Feature` type ships only this slice's fields; slice 4 adds
  `unapproved`, `cardState`, `flags`, `warnings` and `artifacts`.
- Feature rows in the sidebar are plain `ListRow`s (folder icon, stage
  label as meta, `Done` when complete) above the project's sessions. They
  are not clickable yet; slice 3 builds the tree.

## Slice 2 — Live discovery and a guarded workflow

Verification: `npm test` 105/105 passed outside the sandbox (inside it the
four real-tmux tests fail as in slice 1, and the three real-watcher tests in
`watcher.test.ts` skip themselves: `fs.watch` starts there but then emits
`EMFILE`); `npm run typecheck` clean; `npm run build` clean. Manual check
passed (human, 2026-10-05). Risk from the
design checked before planning: `require('chokidar')` (ESM-only 5.0.0)
works in Electron 44's CJS main (Node 24.21), so chokidar stays an
externalized `dependency`, with no bundling fallback. The built
`out/main/index.js` also loads past its `require("chokidar")` under
Electron.

Deviations (all small, two-way):

- Watchers are injected into core (`CoreOptions.watchers`, default
  `chokidarWatchers`), like the session backend. Core tests use
  `FakeWatchers` and fire callbacks by hand, so they don't depend on
  `fs.watch`. `CoreOptions.workflowPath` was renamed `bundledWorkflowPath`.
- A root that doesn't exist yet (and a root that disappears) is re-checked
  on the existing 5 s liveness poll (`syncProjects(false)`). `from_file`
  and the workflow file are watched directly, so their changes apply within
  about 1 s.
- A non-absolute, non-`~/` `workflow` in `config.json` is an error
  (`config.json workflow: expected an absolute path or ~/…`) and loads no
  workflow, the same as a broken custom file at start.
- Validation also rejects unknown keys at the top level and on stages,
  undefined template variables (beyond the reserved `{repo}`/`{repo_path}`),
  duplicate stage ids, a `kinds`/`flows` `default` that isn't a value,
  `stage_actions` keys that are neither `default` nor a stage, and unknown
  action ids. Errors are joined with `; ` into the one `workflowError`
  string. A YAML error keeps only the first line of the parser's message,
  which carries `at line L, column C`.
- Watcher `error` events are logged with `console.warn` in main and
  otherwise ignored: `app:errors` is fetched once at startup, so it can't
  carry them.
- `workflow` in `config.json` is preserved on every config write (core
  keeps the value read at start). Hand edits while the app runs are still
  overwritten on the next project change (design Risks).

## Slice 3 — The tree

Verification: `npm test` 109/109 passed outside the sandbox (inside it the
real-tmux tests fail and the real-watcher tests skip, as before);
`npm run typecheck` clean; `npm run build` clean. Manual check passed (human,
2026-10-05).

Deviations (all small, two-way):

- A feature nests under any feature in the same project named by its
  `parent`, not only under `group` kinds; a `parent` naming no feature in
  the project leaves it top-level.
- Under a feature, its linked sessions come first, then its child features.
- Feature rows collapse from a chevron button shown only when the feature
  has children. The row itself has no click action until slice 4.
- `src/core/sessions.test.ts` "persists ui changes" spelled out the old
  two-field `UiState`; it now expects `{ ...DEFAULT_UI, focusedSessionId: 'x' }`.
- `stateStore` merges a saved `ui` over `DEFAULT_UI`, so any later
  `UiState` field also defaults for old files.

## Human feedback

- 2026-10-05, after slice 3: most rows read "Questions", so features are
  hard to tell apart. Slice 4 adds card state to the row and the
  "unapproved" rule (see slice 1's probe note).
- 2026-10-05: may later want to switch the sidebar between a session view
  and a feature view. Not in the design; a candidate for a new ticket or a
  design revision. Not built here.

## Open questions
