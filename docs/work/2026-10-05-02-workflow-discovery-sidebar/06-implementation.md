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
  - 05-plan.md@1
forced: []
---

# Implementation: workflow, discovery and sidebar

## Progress

- [x] Slice 1 — Tracer: features from the bundled workflow, read once (manual check pending)
- [ ] Slice 2 — Live discovery and a guarded workflow
- [ ] Slice 3 — The tree
- [ ] Slice 4 — Feature page
- [ ] Slice 5 — Manual link
- [ ] Slice 6 — Board (appetite cut 1)

## Slice 1 — Tracer: features from the bundled workflow, read once

Verification: `npm test` 83/83 passed (run outside the Claude Code sandbox:
inside it the four real-tmux tests in `src/core/backend/tmux.test.ts` fail
to reach the tmux socket, unrelated to this change); `npm run typecheck`
clean; `npm run build` clean. The manual `npm run dev` check is for the human.

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

## Open questions
