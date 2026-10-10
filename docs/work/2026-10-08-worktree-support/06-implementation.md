---
feature: 2026-10-08-worktree-support
phase: implementation
status: draft
version: 2
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
| 1 | Tracer: a worktree session, nested under its repo | done, reviewed and approved by the human (2026-10-10) |
| 2 | Lifecycle: conflicts, locking, pruning, removal | implemented (2026-10-10), awaiting the human's review |
| 3 | One card per feature, with a divergence chip | not started; scope grew, see below |
| 4 | Review comments stay unambiguous across checkouts | not started |

Slice 1's commits: `2d109c6` (the tracer), `ea532dc` and `cf24796` (two corrections the
human's testing found — the missing rail colour bar, then the broken bar line). Approving a
slice is the human's conversational checkpoint; `06-implementation.md` itself is approved
once, at the end, with `grove-approve <slug> implementation`.

## Between the slices: a repo-wide audit (2026-10-10)

The human asked for every place that treats a checkout as a repo now that worktrees exist.
Most of what the audit found is already owned by slice 3 (the worktree page's duplicate
Features board, the repo page's copies, ⌘B from a worktree session). Two things were not, and
were settled directly:

- **No ui key outlives its project** (`3f70143`, this session). Removing a project cleared
  only `focusedProject`, so its `p:`/`w:`/`o:w:` group keys and its `hiddenProjects` entry
  stayed in `state.json` for good — the human's own state file already carried `o:w:<id>` for
  a worktree project that no longer existed. `forgetProjectUi()` drops all three, and runs on
  removal and once at start, so it also covers slice 2's prune of a dead worktree and a
  project deleted from `config.json` by hand. The group-key format moved to
  `@shared/groups`, because core now has to recognise those keys and the renderer draws them.
- **The command palette listed every feature once per checkout** — 20 features across 2
  checkouts of grove are 40 entries, half with duplicate labels. `paletteItems.ts` was in no
  slice, so the human approved adding it to slice 3 (`04-structure.md` v2).

The three pickers the audit found were then decided by the human, not fixed piecemeal: the
palette's project entries and the grid toolbar's filter tabs group by repo, and the repo's page
lists every checkout's sessions so it agrees with the sidebar; ⌘T's new-session list stays per
checkout, because starting a session in a chosen checkout is a real thing to do. All three went
into slice 3 (`04-structure.md` v3) rather than being applied here, so the palette, the board and
the page change in one coherent slice instead of three passes over the same files.

Still open for the human, not yet in any slice: whether slice 4's "two checkouts in one message"
is reachable at all, since `reviewSend` sends one session's drafts and a session has one
checkout. The human's answer: rewrite slice 4 to the part that is real.

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

Then the human tested the rail again and the bar was still wrong, in the opposite way: the
worktree had become a second block, so `grove` and `grove · probe` drew two bars of the
*same* colour with a `--sp-3` gap between them — a break in the line, which reads as two
projects rather than one repo. Nesting is not something the rail can draw: at 56px the bar is
its only grouping cue, and a bar cannot be both "the same project" and "a different group".
So the rail stopped trying to nest. Each block is one repo, its worktrees' tiles folded into
the same run in `orderedSessions` order (`SidebarRail.tsx:38-43`), with one continuous bar.
⌘N still lines up, because ⌘N was always `orderedSessions(listGroups(...))`. The full
sidebar keeps the real nesting: heading, indent, collapsed worktree rows.

Trade-off accepted: the rail no longer says which checkout a tile is in. At that width it
could not do so honestly anyway — the tile's tooltip carries the session's name, and the
sidebar shows the checkout.

Then the human found the same mistake in the options panel: it listed the worktree as its own
project, with its own visibility checkbox. Hiding is a choice about a **repo**, not about one
of its checkouts, so the panel now lists one row per repo (`repoRows`, in `repoGroups.ts`),
counting every checkout's sessions into it, and `listGroups` reads `hiddenProjects` as repo
ids only: a hidden repo takes its worktrees with it, and an id that is not a checkout head —
one saved before worktrees were projects of their own — is ignored, rather than left in
place to hide a checkout whose repo the sidebar still lists.

### Verification

`npm test` (68 files, 714 tests — was 65/673), `npm run typecheck`, `npm run build`: all
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

## Slice 2 — Lifecycle

### What landed

The branch conflict is now grove's sentence rather than git's `fatal`, a worktree is locked for
exactly as long as a session runs in it, removing a project that still owns a busy worktree is
refused, a worktree project whose directory is gone is dropped at start (with git's admin entry
pruned beside it), and `cleanupMergedWorktrees` reclaims the merged ones.

Nothing in `src/core/diff/`, `src/core/discovery/`, `src/core/autolink.ts` or
`src/core/artifacts/` was touched; `ConfigFile.schemaVersion` stays 1 and `StateFile` stays 8,
so this slice migrates nothing.

### Decisions and deviations

1. **The probe answers three conflicts, not one.** `conflict()` (`worktrees.ts`) reads `git
   worktree list --porcelain` for the first two — the branch is checked out in another worktree,
   and the target path is already a worktree of the repo — and then asks `rev-parse --verify
   --quiet refs/heads/<branch>` for a branch that exists with no checkout at all. The third is
   the one slice 1's decision 5 promised ("slice 2 will say so in our own words"), because
   `feat/auth/login` and `feat-auth-login` both land in one folder and the second create would
   otherwise die on git's `a branch named … already exists`. Each says where the conflict is:
   `branch fix-auth is already checked out at /Users/me/.grove/worktrees/grove/fix-auth`.
   `cliServer` already turns a failed `add` into `worktree-failed` with the message attached, so
   the CLI prints it unchanged.
2. **Locking happens in `sessionCreate`, not right after `add`.** The design's program flow puts
   `lock` in the CLI's sequence (add → submodule update → lock → `resolveProject` →
   `sessionCreate`), which would leave a session started from the GUI in a worktree unlocked —
   and "a stray `prune`/`gc` cannot remove it under a live agent" is the whole reason the lock
   exists. `sessionCreate` is the one place every session passes through, so it locks there and
   the CLI path is covered by the same call.
3. **Unlock means "no live session left", checked at kill and at remove.** `sessionKill` and
   `sessionRemove` both re-check `hasLiveSessions` *after* the session is gone or dropped, so a
   worktree with two sessions stays locked until the last one stops. `sessionKill` unlocks as
   well as `sessionRemove`: a killed pane is `gone`, not running, and the design's rule is
   "locked while a session runs on it".
   *Gap, deliberately left:* a session that dies on its own (the agent exits, `checkLiveness`
   marks it gone) never runs either of those, so its lock stays until the human ⌘Ws the session
   or unregisters the project. The structure named `sessionCreate`, `sessionKill`,
   `sessionRemove` and `start` — `checkLiveness` was not in it, and unlocking there would mean
   re-deriving "the last session on this project" on every poll. The lock only ever costs a
   `git worktree unlock`, and `remove` refuses a locked worktree, so nothing is trapped.
4. **`lock`/`unlock`/`prune` return `Promise<boolean>`, not `Result`.** They are best-effort by
   design: git refusing to lock must never fail the session command that asked, and a `Result`
   would invite every caller to handle an error none of them can. `remove` returns a `Result`,
   because its refusal (dirty or locked) is an answer the caller shows.
5. **`remove` never passes `--force`.** `git worktree remove` refuses a worktree with
   uncommitted work and one that is locked, and that refusal is correct: an agent's uncommitted
   work is the human's to discard, and a locked worktree has a session in it. `--force` twice
   would override both, which is a decision the design does not make.
6. **`projectRemove` on a worktree project unregisters it and nothing else.** The checkout and
   the branch stay on disk. "Removing a project from grove is not a delete" is already how it
   behaves for an ordinary project; a worktree must not be the one case where the same command
   removes files. `cleanupMergedWorktrees` is the deliberate delete, and only for merged
   worktrees.
7. **`projectRemove` reuses `has-live-sessions` for a busy child** rather than a new code, so
   the existing UI copy ("has running sessions") is right for both and no IPC string changed.
8. **Pruning at start does write `config.json`.** W2 rejects *repairing* `worktreeOf` at
   startup; the design's "Dead worktree projects | Pruned at start" is a different, deliberate
   write, and the row has to go from the file or it comes back on the next launch. It happens
   before `syncProjects(true)`, so a dead worktree also costs no watcher. It unlocks before it
   prunes — see the correction below.
9. **Only `worktreeOf` projects are pruned, ever.** A plain project's folder may be on a disk
   that is not mounted yet, or behind a network share that is slow to answer; a worktree's
   directory is one grove created itself. Both are asserted in the tests.
10. **`realPath` is now exported from `git.ts`** (it was a private `real`, decision 10 in slice 1)
    because `worktrees.ts` needs to compare a path against the one git printed, which is always
    realpath'd. `core.ts` uses the `realOrSelf` it already imports.
11. **`cleanupMergedWorktrees` is a `Core` method with no user-visible surface yet.** The design
    names the action ("clean up merged") but not where it lives, and slice 2's files are
    `worktrees.ts` and `core.ts` only — an IPC channel plus a control is the renderer's, and
    slice 3 and 4 are both renderer slices. It is a seam: `core.cleanupMergedWorktrees()` is
    callable and tested, and wiring it to a button or a `grove` verb is a small addition once
    its home is decided.
12. **`merged` means `merge-base --is-ancestor` against the default branch**, so a worktree
    nobody has committed anything in counts as merged (its branch still *is* the default
    branch). That is correct — such a worktree holds nothing the checkout does not — and git's
    own refusal on uncommitted work keeps its files. The tests give every worktree a real commit
    so "unmerged" means unmerged.
13. **Three test files, two of them not in the structure**: `src/core/worktreeLifecycle.test.ts`
    (NEW, the core-level lifecycle: lock, unlock, prune at start, clean up merged) and additions
    to `src/core/worktrees.test.ts` and `src/core/projects.test.ts`. One existing assertion
    changed: `cliServer.test.ts` asserted git's raw `fatal: … already exists` for a second
    `--branch main`, which is the message decision 1 replaces.
14. **`worktrees.list` still has no non-test caller outside `worktrees.ts` itself** — `conflict`,
    `merged` and `prune` all use it. Slice 1's decision 9 left it unused; it is no longer dead.

### Verification

`npm test` (69 files, 740 tests — was 68/714), `npm run typecheck`, `npm run build`: all
clean. Beyond the unit tests, these are proven against **real git**:

- A branch checked out in another worktree, the checkout's own branch, a branch that exists with
  no checkout, and a path that is already a worktree are each refused **before** `git worktree
  add`, with a sentence naming the other checkout; `git worktree list` afterwards shows nothing
  new and no directory is created (`worktrees.test.ts`). A plain directory that is not a worktree
  still falls through to git, whose own refusal is propagated unchanged.
- `lock` puts `locked <reason>` in `git worktree list --porcelain`; with the directory then
  `rm -rf`'d, `git worktree prune` leaves the worktree in place and `unlock` + `prune` finally
  removes it — the whole point of the lock, against the real command
  (`worktrees.test.ts`).
- `remove` deletes a clean worktree and leaves its branch; refuses a worktree with uncommitted
  work and a locked one, with git's message and the files untouched (`worktrees.test.ts`).
- A session created in a worktree locks it; `sessionKill` leaves it locked while a second session
  is running and unlocks it when the last one stops; `sessionRemove` unlocks it; a session in a
  plain checkout locks nothing; with no git runner at all, a session still starts and nothing
  locks (`worktreeLifecycle.test.ts`).
- `rm -rf` a worktree, restart a core: the row is gone from `projects` and from `config.json`,
  git's stale admin entry is pruned, a live worktree project and a plain project with a missing
  folder are both kept, and `core.getErrors()` is empty (`worktreeLifecycle.test.ts`).
- `cleanupMergedWorktrees` deletes a merged worktree nobody is working in (branch kept, project
  and config entry gone), keeps an unmerged one, keeps a merged one with a running session, and
  reports git's own refusal for one with uncommitted work (`worktreeLifecycle.test.ts`).

**Not run here — the manual half of slice 2's verification**, which needs the app and a real
terminal. In `npm run dev`:

1. `grove new claude --worktree --branch taken` twice: the second refuses with
   `branch taken is already checked out at ~/.grove/worktrees/grove/taken`, and no second
   worktree appears.
2. With a session running in a worktree, `git worktree list` in the checkout shows
   `locked a grove session is running here`; run `git worktree prune` yourself — the worktree
   stays.
3. ⌘W that session: the lock line goes away, and `git worktree prune` still leaves the worktree
   (the directory is there, which is what prune checks).
4. `rm -rf` a worktree directory and quit and restart grove: its row is gone from the Projects
   tab and the Sessions tab.
5. Remove a repo project that still owns a worktree with a running session: the confirm refuses;
   once that session is gone it removes.
6. Removing a *worktree* project itself unregisters the row and leaves the directory and branch
   on disk.
7. `cleanupMergedWorktrees` is not reachable from the UI yet (decision 11) — until its home is
   decided, exercise it from a scratch core or skip this step.

### The manual half, driven for real

Six of those seven steps are not a GUI exercise at all, so they were run against the real thing:
the actual `createCore`, the actual tmux backend (`TmuxBackend` on its own socket), the actual
`startCliServer` over a real unix socket, the actual `grove` CLI spawned as a child process, and
the actual git. The harness is thrown away — it lives in `out/`, which is gitignored.

Results:

1. `grove new terminal --cwd <repo> --worktree --branch X --json` twice → exit 1 with
   `grove: worktree-failed: branch X is already checked out at /Users/victor/.grove/worktrees/probe-repo/X`,
   and `git worktree list` shows exactly two entries. A `pwd` typed into the pane comes back as
   `/Users/victor/.grove/worktrees/probe-repo/X`, so the session really is in the worktree.
2. `git worktree list` shows `locked`; `git worktree prune -v` run by hand → the worktree stays.
3. `grove kill <id>` → the lock line goes. The ⌘W path (`commands.sessionRemove`, what the menu
   item calls) → the lock line goes.
4. `rm -rf` a worktree **with a live session in it**, then a real core restart → the row is gone
   from `projects` and from `config.json`, and git's admin entry is pruned.
5. `projectRemove` on the checkout with a busy child → `has-live-sessions`, projects unchanged;
   after the child stops → `ok`, and the checkout's children survive it.
6. Removing a worktree project → row gone, directory on disk, branch on disk.
7. `cleanupMergedWorktrees` reclaimed both merged worktrees, branches kept.

**Two real bugs came out of that run, both now fixed and pinned by tests that fail without the
fix:**

- **`merged` could not find a worktree whose checkout was not a registered project.**
  `cleanupMergedWorktrees` runs git with the parent checkout's path when there is one and the
  worktree's own path otherwise — and `merged` excluded "the checkout" by comparing its argument
  against the path git printed. Asked from inside a worktree, that excluded *itself*, so such a
  worktree could never be cleaned up. It now asks which entry is the checkout by what that
  checkout is: the one whose `.git` is a **directory**, where a linked worktree's is a file. Said
  that way it holds however the caller spells `repo`, and it cannot accidentally offer to delete
  the checkout (a checkout's own branch is trivially an ancestor of itself).
- **A worktree deleted under a live session left a permanent ghost in git.** The row was pruned
  at start, but `git worktree prune` refuses to prune a *locked* worktree, and grove had locked it
  for the session that was running when the directory went. Only `git worktree unlock` by hand
  could ever clear it. `start` now unlocks a dead worktree before pruning it: nothing is running
  in a directory that is gone, and the lock has nothing left to protect.

Only the pixels remain unverified: the confirm dialog's wording, the Projects tab's row, and the
menu accelerator that reaches `session:remove`. Nothing left to do there but look.