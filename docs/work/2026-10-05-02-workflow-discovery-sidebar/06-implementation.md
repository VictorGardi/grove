---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: implementation
status: draft
version: 4
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@6
forced: []
---

# Implementation: workflow, discovery and sidebar

## Progress

- [x] Slice 1 — Tracer: features from the bundled workflow, read once
- [x] Slice 2 — Live discovery and a guarded workflow
- [x] Slice 3 — The tree
- [x] Slice 4 — Feature page
- [x] Slice 5 — Manual link
- [x] Slice 6 — Board (appetite cut 1)

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

## Slice 4 — Feature page

Verification: `npm test` 120/120 passed outside the sandbox (inside it the
real-tmux tests fail and the real-watcher tests skip, as before);
`npm run typecheck` clean; `npm run build` clean. Manual check passed (human,
2026-10-05).

Probe over this repo's `docs/work`, as the sidebar rows now read:
walking-skeleton, this feature and visual-foundation "Implementation ·
Needs review"; children 03–08 "Questions · Backlog"; the epic "Done" (its
draft `01-questions.md` is an unapproved pass and 02–04 are approved).

Deviations and readings (all small, two-way):

- `done` means "no current stage": every effective stage is complete or an
  unapproved pass. ADR 0002 counts a passed stage as not incomplete for
  stage derivation, and this is the only reading where every feature has a
  card state (a feature whose stages are all complete or passed has no
  current stage, so `needs-review`/`ready` can't apply). The timeline still
  marks those stages "unapproved".
- An unapproved pass looks only at effective stages, so a `small` feature
  with a stray `02-research.md` keeps `questions` current.
- Added a `kind?` warning next to `flow?`, for an unknown kind value (see
  slice 1).
- Sidebar feature rows read `<current stage> · <card state>`
  (`featureSummary` in `src/renderer/src/featureLabels.ts`), or `Done`, in
  answer to the human's feedback after slice 3.
- The feature page lists every file in the folder (including
  `feature.md`), tagging stage artifacts and reviews; files are not
  openable (child 4).
- The test fixture in `tree.test.ts` gained the new `Feature` fields.
  `stateStore.test.ts`'s round-trip fixture gained `focusedFeature`.

## Slice 5 — Manual link

Verification: `npm test` 127/127 passed outside the sandbox (inside it the
real-tmux tests fail and the real-watcher tests skip, as before);
`npm run typecheck` clean; `npm run build` clean. Manual check passed (human,
2026-10-05).

Deviations and readings (all small, two-way):

- Card state order is `done` > `running` > `backlog` > `needs-review` >
  `ready`. The epic design says `needs-review` needs "no running session"
  but doesn't order `running` against `backlog` or `done`. A done feature
  with a lingering live session stays `done`. A backlog feature with one
  reads `running`.
- The picker lists every feature in the session's project, epics (group
  kinds) included, in `features.items` order (by slug). Core accepts any
  of them.
- Added a `link` icon (Lucide) to `ui/Icon.tsx` for the card's "Link…"
  button. The button shows on hover with the other card actions, for gone
  sessions too.
- Features re-derive on every sessions-slice write (`set('sessions')` calls
  `publish()`), including liveness flips and renames.

## Slice 6 — Board (appetite cut 1)

Verification: `npm test` 129/129 passed outside the sandbox (inside it the
real-tmux tests fail and the real-watcher tests skip, as before);
`npm run typecheck` clean; `npm run build` clean. Manual check passed (human,
2026-10-05).

Deviations and readings (all small, two-way):

- Cards are the non-`group` features rather than literally `kind: feature`,
  so no app code names a grove kind (Desired state 8). With the bundled
  workflow, that is the same set.
- The toggle sits in the content header (`shell/ViewToggle.tsx`), on every
  page. While `view` is `board`, the content area shows the Board whatever
  is focused; clicking a sidebar session or feature row focuses it but the
  Board stays until the human switches to List. Clicking a Board card sets
  `view: 'list'` and the focused feature in one `ui:set`.
- The Board shows every project's features; a card's meta line adds the
  project name only when more than one project is registered.
- The plan's "check `StatusTone` has `idle`" step was dropped while
  planning: it does, so cards use the `idle` tone for their card-state label.

## After the last slice: changes the human asked for

Asked for on 2026-10-05, after slice 6's manual check: "fix the gaps right
away", and colours for repos and epics. Not in `04-structure.md`; built
here and logged instead of a new slice.

Verification: `npm test` 137/137 passed outside the sandbox;
`npm run typecheck` clean; `npm run build` clean. Probe over this repo's
`docs/work`: the epic reads `Active · 0 / 9 done`; the other rows are
unchanged. Manual check pending.

- **Epic done only when its children are (one-way, human decision).** This
  amends E-D2. The human chose a new `active` card state over reusing
  `ready` or mirroring the busiest child, and chose to amend the epic design
  and build now. The epic's `03-design.md` is now v4, `draft`, and needs
  re-approval (`grove-approve 2026-10-05-opencode-feature-workspace design`).
  ADR 0002 is amended. Rule: a group is `done` only when its own effective
  stages are complete and every child (same project, by `parent`) is
  `done`. Until then, with its own stages complete, it is `active`, and the
  row reads `Active · n / m done`. A group with no children is done by its
  own stages; nested groups resolve recursively.
  Code: `CardState` gains `active`; `Feature.progress` (groups with children
  only); `withGroups` in `derive.ts`; tree sorting uses `cardState === 'done'`,
  so an active epic sorts with the active features; the feature page shows
  the progress next to the card state badge.
- **`implementation` approval unit (`docs/skills-changes.md` §1).** Built in
  the grove-skills repo (uncommitted there for the human's review): the unit
  in `shared/approve.md` (validation: every structure slice has a fully
  ticked `05-plan.md` section; marks nothing stale), the "approved 06 =
  done" rule in `shared/contract.md`, the unit in `grove-approve`'s inputs,
  and the hand-off line in `grove-implement`. Copies synced with
  `scripts/sync-shared.sh`; `scripts/validate.sh` passes. Finished features
  still need their `06-implementation.md` approved by hand to read `done`.
- **Colours for repos and epics (two-way).** Eight `--tag-N` colours in
  `tokens.css`, clear of the accent and status hues. `colorTags` in
  `src/renderer/src/tags.ts` gives each project the colour at its position
  and each project's epics (group kinds, by slug) the colours after it, so an
  epic never shares its own project's colour below eight epics. The sidebar
  colours the project folder icon, the epic's icon, and a left rail down
  everything nested under an epic; Board cards show coloured project and epic
  chips (`ui/Tag.tsx`).
- Staleness: this feature's `03-design.md` is based on
  `parent:03-design.md@3`; the epic design is now v4.

## PR description

**Workflow, discovery and sidebar** (epic child 2,
`2026-10-05-opencode-feature-workspace`)

Features now appear and move through stages driven only by `workflow.yaml`.

Design in brief: core (Electron main) loads `workflow.yaml` from
`config.json`'s `workflow` path, or the bundled grove example
(`resources/workflow.yaml`, flows `full`/`standard`/`small`). It validates
the file, watches it, and keeps the last valid one behind a banner when it
breaks. Per project it resolves the discovery root, watches it with
chokidar and reads frontmatter with `yaml` (core schema, own splitter, ADR
0013). Pure functions derive each feature's effective stages (kind ∩ flow),
current stage, "unapproved" passes, flags, warnings and card state; core
pushes the whole `features` slice to the renderer, which derives nothing.
New UI state (`view`, `collapsed`, `focusedFeature`) is additive at
`schemaVersion: 1`.

Slices:

1. Tracer: features from the bundled workflow, read once at startup.
2. Live discovery (chokidar) and a guarded, validated workflow with a
   banner; custom `workflow` path.
3. The tree: project → epic → feature → linked sessions, plus unlinked
   sessions; collapse persists; Cmd+1..9 follows the tree.
4. Feature page: stage timeline (complete / current / unapproved /
   upcoming), card state, flags, warnings, files, linked sessions.
5. Manual link: "Link…" on a session card; `session:link` pins the link;
   linked live sessions make a feature `running`.
6. Board: List/Board toggle; one column per stage, epics excluded,
   children show their epic's name.

How to verify:

- `npm test` (outside a sandbox that blocks the tmux socket and
  `fs.watch`), `npm run typecheck`, `npm run build`.
- `npm run dev`, register this repo: features show under the project with
  stage and card state; `mkdir` a folder with `feature.md` and it appears;
  open a feature page; link a terminal to a feature and restart; toggle to
  Board and click a card.

Also, at the human's request after the last slice: an epic is `done` only
once all its children are, and reads `Active · n / m done` until then (E-D2
amended, epic design v4 awaiting re-approval); repos and epics get their own
colours in the sidebar and on the Board; the grove-skills `implementation`
approval unit is built in that repo.

Known gap: existing finished features read `done` only once their
`06-implementation.md` is approved with `grove-approve <slug> implementation`.

## Human feedback

- 2026-10-05, after slice 3: most rows read "Questions", so features are
  hard to tell apart. Slice 4 adds card state to the row and the
  "unapproved" rule (see slice 1's probe note).
- 2026-10-05: may later want to switch the sidebar between a session view
  and a feature view. Not in the design; a candidate for a new ticket or a
  design revision. Not built here.
- 2026-10-05, after slice 4: an epic should be done only once all its
  features are done. Today a `group` kind's card state comes from its own
  stages only (E-D2), so the epic reads "Done" once its structure is
  approved. Changing it touches E-D2: next step is `grove-design
  2026-10-05-opencode-feature-workspace` in revise mode (also deciding what
  an epic shows while its own stages are done but children aren't, e.g.
  "n / m done"). Not built here.

## Open questions
