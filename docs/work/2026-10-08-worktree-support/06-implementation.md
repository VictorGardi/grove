---
feature: 2026-10-08-worktree-support
phase: implementation
status: draft
version: 1
created: 2026-10-10
updated: 2026-10-10
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@1
forced: []
---

# Worktree support — implementation log

## Progress

| Slice | Outcome | State |
|---|---|---|
| 1 | Tracer: a worktree session, nested under its repo | done, committed (one correction after the human tested it) |
| 2 | Lifecycle: conflicts, locking, pruning, removal | not started |
| 3 | One card per feature, with a divergence chip | not started |
| 4 | Review comments stay unambiguous across checkouts | not started |

## Slice 1 — Tracer

### What landed

`grove new <kind> --worktree --branch <b>` makes a `git worktree` under
`~/.grove/worktrees/<repo>/<branch>`, registers it as a `Project` of its own with
`worktreeOf` naming the repo's checkout, and starts the session there. The sidebar and the
Projects tab draw the worktree nested under the repo, collapsed until opened. Nothing in
`src/core/diff/`, `src/core/discovery/`, `src/core/autolink.ts` or `src/core/artifacts/`
changed: `project.path` *is* the worktree, which is the whole of ADR 0037's claim.

### Decisions and deviations

1. **The parent is found by git, at registration, never at startup.** `parentCheckout(dir,
   projects)` (`src/core/projects.ts`) returns the registered project whose own `.git`
   *directory* realpath is `dir`'s `gitCommonDir`. It is called from the two registration
   paths — `resolveProject` (`cliOps.ts:55`) and `projectAdd` (`core.ts:601`). Nothing
   repairs `worktreeOf` on load: W2 rejects startup repair, because it writes to
   `config.json` at start, which `core.ts:840` avoids on purpose.
   *Deviation:* the structure's file list implies `cliOps.ts` only; `projectAdd` needed the
   same call, because "cannot be absent" in W2 is only true if adding a worktree folder by
   hand through grove's own UI also nests it.
2. **The renderer nests by `worktreeOf`; git derivation happens in core.** `repoGroups(projects)`
   is a pure function of `Project[]` (the design's stated signature) and the renderer has no
   filesystem, so the value it reads is always one core derived from `gitCommonDir`. This is
   W2 read to fit the two signatures the design fixes, not a new decision. A worktree made
   by hand, outside grove, stays an ordinary top-level project — which is what the
   two-way table already says ("Hand-made worktrees: not adopted in v1").
3. **`Core` exposes `gitTop(dir)` and `git`.** The design's program flow puts `worktree add`
   *before* "the existing `sessionCreate`, unchanged", so the worktree is made in
   `cliServer.ts` — which needs to resolve the repo and run git. Both were already closures
   in `createCore`; they are now on the interface. The alternative (a `worktree` option on
   `sessionCreate`) would have changed the method the design says stays unchanged.
4. **Worktree rows collapse without a new ui field.** They start collapsed, so the human's
   own choice is remembered the other way round: `ui.collapsed` holds the key a row was
   *opened* under (`o:<groupKey>`, via `collapseKey`). `StateFile.schemaVersion` stays 8 and
   `UiState` is untouched, as 04-structure's rollout section requires.
5. **Branch sanitising.** The design says "sanitized for separators" without naming a rule;
   this uses `replace(/[^A-Za-z0-9._-]+/g, '-')`, so `feat/auth/login` → `feat-auth-login`.
   That can collide with a branch literally named `feat-auth-login`, which git refuses with
   "already exists" — a clear error, not corruption. Slice 2 will say so in our own words
   when it probes `list` first.
6. **`newProject(dir, id, parent?)` takes the parent project, not its id**, so it can also
   apply the two-way naming rule `<repo> · <branch>`: a worktree is called `grove · fix-auth`,
   not `fix-auth`.
7. **`navigation.ts` is unchanged.** ⌘B from a worktree session opening the parent repo's
   page is slice 3's outcome. Slice 1's ⌘1-9 order comes free from `listGroups` →
   `orderedSessions`, asserted in `navigation.test.ts` without touching the source.
   *Deviation:* the structure lists `navigation.ts` in slice 1's files; it turned out not to
   need it.
8. **Two test files the structure did not name**: `src/core/worktrees.test.ts` and
   `src/renderer/src/repoGroups.test.ts`, one per new module.
9. **Locking is not in slice 1.** The design's program flow lists `lock` right after `add`,
   but `worktrees.lock` is slice 2's signature, so a worktree this slice creates is unlocked.
   `worktrees.list` is likewise built and tested but unused until slice 2's probe needs it.
10. **`git.ts` keeps a private `real()`**, duplicating `realOrSelf` (`cliOps.ts:29`).
    Importing it would close a cycle (`git → cliOps → projects → git`).
11. **The submodule test sets `protocol.file.allow` on its own git runner** so a `file://`
    submodule can be cloned. grove never sets it; the production path runs
    `git submodule update --init --recursive` verbatim (Q7).

### Correction after human testing

The first pass made `colorTags` return `null` for a worktree, which is right about palette
*slots* — a worktree must not push the projects after it onto a different colour — but wrong
about the colour itself. `tags.project(id)` feeds the rail's bar and all three sidebar folder
icons, so a worktree's block in the rail was drawn with no bar at all, and its row in the
sidebar had an uncoloured folder icon. `project(id)` now resolves a worktree to its
checkout's slot: a worktree takes no slot of its own and wears its repo's colour.

`src/renderer/src/railBars.test.ts` was added to pin the composed result (block order and
bar class per block), because the components have no render harness and this was the second
composition gap in the slice that unit tests on the pieces did not catch.

### Verification

`npm test` (68 files, 713 tests — was 65/673), `npm run typecheck`, `npm run build`: all
clean. Beyond the unit tests, these are proven against **real git**:

- `gitCommonDir` returns exactly what `git rev-parse --git-common-dir` returns, for a
  checkout and for a real `git worktree add` checkout of the same repo (`git.test.ts`).
- `worktrees.add` creates a real worktree whose `git rev-parse --show-toplevel` is the
  intended path, on the new branch, with the committed tree checked out; the main checkout
  stays clean and on its own branch; submodules are initialised; git's own refusal
  ("already exists") is propagated and nothing is half-created (`worktrees.test.ts`).
- A session created with `cwd` at a worktree of a registered checkout registers a project
  whose `path` is the worktree root, with `worktreeOf` pointing at the checkout, stores
  `cwd: null`, and starts the pane there — over a real socket, through the real CLI server,
  with `worktree: true, branch: 'probe'` (`sessionCreate.test.ts`, `cliServer.test.ts`).
- That session's **diff is scoped to the worktree** (`diff.root` = the worktree root, one
  file) while the checkout's `git status --porcelain` is empty — the ADR 0037 claim, proved
  without touching `src/core/diff/` (`sessionCreate.test.ts`).
- `config.json` keeps `schemaVersion: 1`, carries `worktreeOf` verbatim, and a fresh core
  reloads it: no migration, no version bump.

**Not run here — the manual half of slice 1's verification**, which needs the app and a real
agent. In `npm run dev`:

1. `grove new claude --worktree --branch probe` → in the pane, `pwd` is
   `~/.grove/worktrees/grove/probe` and `git rev-parse --show-toplevel` matches.
2. The agent writes → grove's diff shows its writes; the main checkout's `git status` is
   clean.
3. The Projects tab shows `grove` with `probe` nested and collapsed; the Sessions tab shows
   the session under it. Open the row, close it, reload: the choice sticks.
4. Create and destroy a worktree: other projects' colours and ⌘1-9 are unchanged.
   (Read: a project with no sessions contributes no panes, so the order cannot move; a
   worktree *with* a session takes the next ⌘N, as any new session does.)
5. Repeat with `grove new opencode --worktree --branch probe2`, and confirm the session
   **auto-links** to a feature after a write into `docs/work/<slug>/` — the one
   agent-dependent path (OpenCode normalises HTTP events at `normalise.ts:118`; Claude reads
   the spool at `source.ts:46-48`). The design's slice-1 manual list also says "OpenCode
   behaves identically" to the Claude run.

Component rendering is not covered by a test: this repo has no jsdom or testing-library and
`vitest.config.ts` runs in a `node` environment, so `Sidebar.tsx` and `SidebarRail.tsx` are
verified by typecheck, build, and the pure selectors they consume (`repoGroups`,
`listGroups`, `collapseKey`, `colorTags`). Slice 3's verify line asks for Board and
ProjectPage render tests — that harness does not exist yet.