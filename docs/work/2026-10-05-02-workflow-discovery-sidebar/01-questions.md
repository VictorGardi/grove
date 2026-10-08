---
feature: 2026-10-05-02-workflow-discovery-sidebar
phase: questions
status: approved
version: 3
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@3
  - parent:04-structure.md@5
forced: []
---

# Questions: workflow, discovery and sidebar

Child 2 of epic `2026-10-05-opencode-feature-workspace`. The epic's research
(v5) and design (v3) are inherited. E-D1 (discovery declared in
`workflow.yaml`, one global workflow), E-D2 (the `workflow.yaml` contract:
four predicates, stage derivation, fixed card states, and since v3 a
`flows` axis: effective stages = kind ∩ flow), and E-D7 (JSON state
files, `workflow` path in config, `linkPinned`, UI state) are settled and
are not re-asked here. Children 1 and 9 have been built since the epic's
research, so the questions below cover the code as it is now, plus grove's
artifact formats where they may have changed.

## Goal

Features appear and move through stages driven only by `workflow.yaml`.

## Out of scope

- Live session status dots, auto-linking from tool events, notifications,
  the waiting count (child 3)
- Opening or rendering artifacts in the app; this child only lists them (child 4)
- Next-action buttons and prompt templating (child 5)
- Comments (child 6), command palette and grid (child 7), packaging (child 8)
- Creating features from the app (epic non-goal)

## Research questions

1. How does core today hold, mutate, persist and push its slices (`projects`,
   `sessions`, `ui`)? Which IPC channels exist, how is a session field such
   as `label`/`labelPinned` changed from the renderer, and how are config and
   state loaded, validated and migrated by `schemaVersion`?
2. How is the renderer structured today: how the sidebar builds its project
   and session rows, how the content area decides what to show, what
   `sidebarOrder` and Cmd+1..9 depend on, and which base components and
   tokens (from child 9) exist, with their props?
3. What does grove's artifact contract say today about `feature.md`
   (including `flow` and `## Flow log`), phase-artifact frontmatter, the
   per-slice `05-plan.md` format and `06-implementation.md`, and which of
   these differ from what the epic research recorded (v5, Q7)? Read the
   installed skills under `~/.claude/skills/grove-*/references/`.
4. Across the feature folders in this repo's `docs/work/`, what frontmatter
   is actually present per file: which fields are missing, which values
   appear for `kind`, `status`, `phase` and `flow`, which folders contain
   files or subfolders that are not phase artifacts, and which features have
   which subset of the numbered artifacts?
5. Which file-watching, frontmatter and YAML parsing libraries are in
   `package.json` and `node_modules` today, at which versions? For chokidar
   and gray-matter specifically (installed or latest): how do they behave on
   macOS for atomic rename writes, folder creation and deletion,
   `awaitWriteFinish`, and malformed or date-typed YAML frontmatter?
6. How does the build (electron-vite config) handle main-process
   dependencies and files under `resources/` (e.g. `resources/tmux.conf`):
   how is such a file's path resolved at runtime in dev, and is any packaged
   path handled yet?
7. What does the test setup cover today: vitest config and environments,
   how core is tested (fake backend, temp dirs, `testing/setup.ts`), whether
   any renderer component tests exist, and what `npm test` and
   `npm run typecheck` report on the current HEAD?

## Product questions for the human

1. **When the config's `workflow` path isn't set, what does the app do?**
   Use the shipped example grove `workflow.yaml` automatically, so features
   show up with zero setup.
2. **How do stages a feature's grove `flow` skips look in the timeline?**
   The app must stay workflow-agnostic: which stages a flow uses is declared
   in `workflow.yaml`, not inferred by app code, and skipped stages are not
   shown as "unapproved" passes. (First answer, "acceptable for now",
   withdrawn.) Resolved upstream: the epic design v3 adds a `flows` axis to
   E-D2; stages outside a feature's effective list are absent from its
   timeline (epic `03-design.md` "`workflow.yaml` shape").
3. **What happens to `done` features in the sidebar tree?** Always shown,
   sorted after active features within their group.
4. **How do epics appear on the Board?** Only `kind: feature` cards; each
   child's card shows its epic's name. Epics themselves are not cards.

## Size verdict

Child of an epic: the size is bounded by the epic's structure (4–5 days,
about 6 slices; Board is the last slice, appetite cut 1).

## Open questions
