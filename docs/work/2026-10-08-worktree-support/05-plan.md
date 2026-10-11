---
feature: 2026-10-08-worktree-support
phase: plan
status: approved
version: 3
created: 2026-10-10
updated: 2026-10-11
based_on:
  - 03-design.md@1
  - 04-structure.md@4
forced: []
---

# Worktree support — plan

Self-approved per slice by grove-implement: mechanical checks passed, not
human-reviewed.

> **Re-planned 2026-10-11.** Slices 1 and 2 were planned against `04-structure.md@1`.
> The human approved re-planning the remaining slices against `04-structure.md@4`, which
> grew slice 3 (the palette's features, the palette's and the grid's project entries) and
> rewrote slice 4. The slice 3 section below is written fresh against the code as slice 2
> left it.

## Slice 1 — Tracer: a worktree session, nested under its repo

- [x] Add `worktreeOf?: string` to `Project` in `src/shared/types.ts` (additive-optional; `ConfigFile.schemaVersion` stays 1, no migration, `StateFile` untouched).
- [x] Failing test in `src/core/git.test.ts` for `gitCommonDir(dir)`: a checkout's own `.git` directory, a linked worktree's `.git` file redirect plus `<gitdir>/commondir`, a directory inside a worktree, `null` outside a repo, and the same value as `git rev-parse --git-common-dir` for a real `gitRepo()` with a real `git worktree add`.
- [x] `gitCommonDir(dir): string | null` in `src/core/git.ts`, following the `headFile` pattern: synchronous, no process spawn, walking up like `readBranch`, resolving `commondir` against the gitdir it is read from.
- [x] Failing test in `src/core/worktrees.test.ts` (NEW) against a real throwaway repo: `path` is `~/.grove/worktrees/<repo>/<branch>` with the branch sanitized for separators, `add` creates a checkout whose `git rev-parse --show-toplevel` is that path on the new branch, `add` runs `git submodule update --init --recursive`, `list` reads `git worktree list --porcelain` into `{ path, branch, head, locked }`, and `add` returns `not-a-repo` outside git.
- [x] `src/core/worktrees.ts` (NEW): `worktreePath(repo, branch, home?)`, `add(o)`, `list(repo, git)`; `add` runs `git worktree add -b <branch> <path>` then the submodule update, and takes a `GitRun`.
- [x] `parentCheckout(dir, projects)` in `src/core/projects.ts`: the registered main checkout whose own `.git` directory is `dir`'s `gitCommonDir`, else `null`; `newProject(dir, id, worktreeOf?)` gains the third argument.
- [x] Failing test in `src/core/cliOps.test.ts`: `resolveProject` sets `worktreeOf` to the parent checkout's id when registering a worktree, leaves it off for a plain checkout, and leaves it off when the repo's checkout is not a registered project.
- [x] `src/core/cliOps.ts`: `resolveProject` passes `parentCheckout(dir, projects)?.id` into `newProject` on the registration path.
- [x] `src/core/core.ts`: `projectAdd` sets `worktreeOf` the same way; `Core` gains `gitTop(dir: string): Promise<string | null>` exposing the existing closure, so the CLI server can resolve a repo without a second git runner.
- [x] Failing test in `src/core/sessionCreate.test.ts`: a session started with `cwd` at a worktree of a registered checkout registers the worktree as its own project (`path` = the worktree root, `worktreeOf` = the parent id), stores `cwd: null`, and starts the backend in the worktree root.
- [x] Failing test in `src/cli/args.test.ts`: `new claude --worktree --branch fix-auth` parses to `{ cmd: 'new', kind: 'claude', worktree: true, branch: 'fix-auth', … }`; `--branch` without `--worktree` and `--worktree` without `--branch` are `UsageError`; `USAGE` gains the two flags.
- [x] `src/cli/args.ts`: `--worktree` (boolean) and `--branch` (string) on `new`, validated as a pair.
- [x] `src/cli/index.ts`: pass `worktree` and `branch` in the `sessions.create` params.
- [x] Failing test in `src/main/cliServer.test.ts`: `sessions.create` with `{ worktree: true, branch }` runs `worktrees.add` against the repo containing `cwd` and starts the session in the new worktree, and refuses `worktree` without `branch` with `bad-params`.
- [x] `src/main/cliServer.ts`: `sessions.create` resolves the repo with `core.gitTop(cwd)`, calls `worktrees.add({ repo, branch, git })`, and passes the worktree path as `cwd` to the unchanged `sessionCreate`; a `Result` failure becomes the reply's error code.
- [x] Failing test in `src/renderer/src/repoGroups.test.ts` (NEW): one group per parent checkout in config order with its worktrees after it, a worktree whose `worktreeOf` names no registered project is its own group, and a plain project's group has no worktrees.
- [x] `src/renderer/src/repoGroups.ts` (NEW): `RepoGroup { key, project, worktrees }` and `repoGroups(projects): RepoGroup[]`.
- [x] `src/renderer/src/tree.ts`: `worktreeKey(id)` and `openedKey(key)` beside `projectKey`.
- [x] Failing test in `src/renderer/src/sessionList.test.ts`: a project group carries its worktree groups as `children`; a worktree group is collapsed until `ui.collapsed` holds its `openedKey`; `orderedSessions` walks children after their parent; `visibleSessions` drops a collapsed worktree group; status and `none` grouping stay flat.
- [x] `src/renderer/src/sessionList.ts`: `ListGroup.children`, repo grouping by `repoGroups` in the `project` mode, worktree groups collapsed by default, `orderedSessions`/`visibleSessions` recursive.
- [x] Failing test in `src/renderer/src/tags.test.ts`: a worktree project takes no palette slot, so the projects after it keep their colours, and its group features take none either.
- [x] `src/renderer/src/tags.ts`: `colorTags` indexes projects without `worktreeOf`.
- [x] Failing test in `src/renderer/src/navigation.test.ts`: `focusTarget` counts a worktree's sessions after its repo's own (⌘1-9 order follows the nested list).
- [x] `src/renderer/src/components/Sidebar.tsx`: the Sessions tab renders each worktree group indented under its repo's heading; the Projects tab lists a repo's worktrees as indented rows; both toggle a worktree group through `openedKey`.
- [x] `src/renderer/src/components/SidebarRail.tsx`: a repo group and each of its worktrees draw as their own tile block, in nested order.
- [x] `Sidebar.module.css` and `SidebarRail.module.css`: one indent class each; no inline styles.
- [x] Run `npm test` (covers `git.test`, `worktrees.test`, `cliOps.test`, `sessionCreate.test`, `cli/args.test`, `cliServer.test`, `repoGroups.test`, `sessionList.test`, `tags.test`, `navigation.test`).
- [x] Run `npm run typecheck`.
- [x] Log the slice in `docs/work/2026-10-08-worktree-support/06-implementation.md`.

## Slice 2 — Lifecycle: conflicts, locking, pruning, removal

- [x] Failing test in `src/core/worktrees.test.ts`: `add` refuses **before** `git worktree add` when `git worktree list --porcelain` shows the branch checked out in another worktree (the message names that path, and nothing is created), when the target path is already a worktree of the repo, and when the branch already exists but is checked out nowhere (`git rev-parse --verify --quiet refs/heads/<branch>` succeeds); git's own refusal still propagates for a non-worktree directory that already exists.
- [x] `src/core/worktrees.ts`: `conflict(repo, branch, path, git): Promise<string | null>` — the sentence to refuse `add` with, or null; called from `add` before `worktree add`.
- [x] Failing test in `src/core/worktrees.test.ts` for `lock`/`unlock`: `list` reports `locked: true` after `lock(repo, path, git)` and `false` after `unlock(repo, path, git)`; a locked worktree survives `git worktree prune` after its directory is deleted, and an unlocked dead one is pruned.
- [x] `src/core/worktrees.ts`: `lock(repo, path, git, reason?)` and `unlock(repo, path, git)`, both best-effort `Promise<boolean>` (git's refusal is never an error the caller must handle).
- [x] Failing test in `src/core/worktrees.test.ts` for `prune` and `remove`: `prune(repo, git)` drops git's stale admin entry for a deleted worktree; `remove(repo, path, git)` deletes a clean worktree's directory and leaves the branch, and refuses a dirty worktree and a locked one with git's own message.
- [x] `src/core/worktrees.ts`: `prune(repo, git): Promise<boolean>` and `remove(repo, path, git): Promise<Result<{ path: string }>>`, the latter without `--force`.
- [x] Failing test in `src/core/worktrees.test.ts` for `merged`: a worktree whose branch is an ancestor of the repo's default branch is listed; an unmerged one is not; the repo's own checkout is never listed; a repo with no default branch gives `[]`.
- [x] `src/core/worktrees.ts`: `merged(repo, git): Promise<Worktree[]>` using `defaultBranch` and `git merge-base --is-ancestor`.
- [x] Failing test in `src/core/worktreeLifecycle.test.ts` (NEW): a session created in a worktree project locks it (`git worktree list --porcelain` shows a `locked` line); `sessionKill` unlocks it once no live session is left on it; `sessionRemove` (⌘W) unlocks it; a plain checkout project is never locked.
- [x] `src/core/core.ts`: `lockWorktree(project)` and `unlockWorktree(project)` beside the other project helpers, running git with the parent checkout's path as the repo (the worktree's own path when the parent is not registered); `sessionCreate` locks after the pane is created, `sessionKill` and `sessionRemove` unlock when `hasLiveSessions` is false for that project.
- [x] Failing test in `src/core/projects.test.ts`: `projectRemove` refuses with `has-live-sessions` while a worktree child has a running session, and succeeds once that session is gone.
- [x] `src/core/core.ts`: `projectRemove` refuses when any project with `worktreeOf === id` has live sessions; a removed worktree project is unregistered only — its checkout is never deleted from disk.
- [x] Failing test in `src/core/worktreeLifecycle.test.ts`: on `start()`, a worktree project whose directory is gone is dropped from `projects` and from `config.json`, and git's stale admin entry is pruned; a live worktree project stays, and a plain project whose directory is gone stays too (only worktrees are pruned).
- [x] `src/core/core.ts`: in `start()`, drop the projects with `worktreeOf` set whose path is not a directory, via `set('projects', …)` before `syncProjects(true)`, then `worktrees.prune` each dropped project's parent checkout.
- [x] Failing test in `src/core/worktreeLifecycle.test.ts` for `cleanupMergedWorktrees()`: a merged worktree with no live session is removed by git and unregistered from `projects` and `config.json`; an unmerged worktree and one with a live session both stay.
- [x] `src/core/core.ts`: `Core.cleanupMergedWorktrees(): Promise<Result<{ removed: string[] }>>`, reusing an `unregisterProject(id)` helper factored out of `projectRemove`.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Log the slice in `docs/work/2026-10-08-worktree-support/06-implementation.md`.

### Corrections from driving the manual verification for real

Found by running the slice's manual list against the real core, tmux backend, CLI socket and
git — see `06-implementation.md`. Both are pinned by a test that fails without the fix.

- `merged` identifies the checkout by `.git` being a directory, not by comparing the `repo` it was
  given with the paths git prints. Comparing excluded the worktree itself when `repo` *was* that
  worktree — which is what grove passes when the repo's checkout is not a registered project —
  so such a worktree could never be cleaned up.
- `start` unlocks a dead worktree before pruning it. `git worktree prune` skips locked
  worktrees, and a worktree deleted while a session was live in it is locked, so its admin entry
  survived as a ghost that only `git worktree unlock` by hand could clear.

## Slice 3 — One card per feature, with a divergence chip

Planned against structure v4 (slice 3 as it now reads, including `paletteItems.ts` and
`GridToolbar.tsx`) and the code as slice 2 left it. `repoGroups.ts` already exists from slice 1
and is what every step below builds grouping on.

- [x] Failing test in `src/renderer/src/repoGroups.test.ts` for `repoHead(projects, id)` (the
  checkout id of the repo holding `id`; `id` itself for a checkout, for a worktree whose parent
  is not registered, and for an unknown id) and `repoProjectIds(projects, id)` (that checkout plus
  its worktrees; `{id}` alone for an unknown id).
- [x] `src/renderer/src/repoGroups.ts`: `repoHead` and `repoProjectIds`, both derived from
  `repoGroups` so there is one definition of "this repo's checkouts".
- [x] Failing test in `src/renderer/src/featureUnion.test.ts` (NEW) for `unionFeatures(features,
  groups)`: one entry per (repo group, slug) — the same slug in two checkouts of one repo gives
  one entry, and the same slug in two different repos gives two; `feature` is the checkout's copy
  when it has one (its `projectId` stays that checkout's, so its artifacts open there) and the
  first copy in config order when it has none; `headId` is the group's checkout; `copies` carries
  every checkout's copy with that checkout's id and name; `flags` are unioned by id across copies.
- [x] `src/renderer/src/featureUnion.ts` (NEW): `Checkout`, `UnionFeature`,
  `unionFeatures(features, groups): UnionFeature[]` and `divergentCopies(feature): Checkout[]`
  (the copies other than the canonical whose `currentStage` differs from it; `[]` when every copy
  agrees or there is one copy).
- [x] Failing test in `src/renderer/src/tree.test.ts`: `linkedSessions(feature, sessions, ids)`
  takes the project ids the linked sessions may live in and keeps the two-argument call equal to
  matching the feature's own project only; `boardColumns` still finds a parent by `projectId`
  first and falls back to the same slug elsewhere in the list, so a feature whose copy and whose
  parent's copy sit in different checkouts of one repo still shows its parent tag.
- [x] `src/renderer/src/tree.ts`: the third `linkedSessions` argument and the `boardColumns`
  parent fallback described above.
- [x] Failing test in `src/renderer/src/boardRender.test.ts` (NEW): rendering `Board` with
  `renderToStaticMarkup` (`react-dom/server`, already a dependency — no DOM, no jsdom) over a
  checkout and a worktree of one repo holding the same slug — the markup holds one card title for
  that slug, not two; the card's own stage is the checkout's; a worktree copy at a later stage
  renders a chip naming that checkout and the card does not; a worktree copy at the same stage
  renders no chip; a session linked to the worktree's copy renders one dot on the one card.
- [x] `src/renderer/src/components/Board.tsx`: `unionFeatures(features, repoGroups(projects))` over
  the features it is handed, one card per entry, `linkedSessions` across the entry's `headId`
  repo, and a chip per divergent copy that calls `onOpen(copy.feature)` and stops the click
  reaching the card.
- [x] `src/renderer/src/components/Board.module.css`: one `.chip` class beside `.tags`; no inline
  styles (`noInlineStyles.test.ts` checks every `.tsx`).
- [x] Failing test in `src/renderer/src/projectPageRender.test.ts` (NEW): rendering `ProjectPage`
  with `board: 'features'` — the checkout's page renders one card per (repo, slug) and its
  Sessions board lists the worktree's session; the same component with `project` set to the
  worktree renders no card for the slug and no stage headings whatever `board` says.
- [x] `src/renderer/src/components/ProjectPage.tsx`: features and sessions scoped by
  `repoProjectIds(projects, project.id)` — except on a worktree page, which is that one checkout's
  sessions only — and `board` read as `'sessions'` when `project.worktreeOf` is set.
- [x] Failing test in `src/renderer/src/tree.test.ts` and `src/renderer/src/navigation.test.ts`
  for ⌘B from a worktree: `boardProject` returns the repo's checkout, not the worktree, for a
  session, a feature and a grid pane in a worktree; `boardKey` on a worktree project page returns
  `openBoard(<repo id>)` rather than a board switch; on a checkout's page it still switches.
- [x] `src/renderer/src/navigation.ts`: `boardProject` maps through `repoHead`, `boardKey`
  sends a worktree page to its repo's page, and `focusTarget` passes `projects` to
  `visibleMembers`.
- [x] Failing test in `src/renderer/src/paletteItems.test.ts`: with a checkout and a worktree of
  one repo both holding one feature, `paletteItems` lists that feature once and one project entry
  (the checkout's); with two repos it lists two project entries; `newSessionItems` still lists one
  entry per project including every worktree.
- [x] `src/renderer/src/paletteItems.ts`: features from `unionFeatures` (running the same
  `focusFeature` on the canonical copy), project entries from `repoGroups` heads only,
  `newSessionItems` untouched.
- [x] Failing test in `src/renderer/src/gridView.test.ts`: `visibleMembers(members, view,
  projects)` with a filter naming a checkout keeps the panes of that checkout's worktrees, a
  filter naming a worktree keeps that repo's panes, and an unknown filter still reads as ALL;
  update the existing calls for the third argument.
- [x] `src/renderer/src/gridView.ts`: `visibleMembers` takes `projects` and filters by
  `repoProjectIds` when `view.filter` is set.
- [x] `src/renderer/src/components/SessionGrid.tsx` and `src/renderer/src/App.tsx`: pass
  `projects` to `visibleMembers`.
- [x] `src/renderer/src/components/GridToolbar.tsx`: tabs from `repoGroups`, one per checkout
  with the name of the checkout, counting its worktrees' panes.
- [x] `src/renderer/src/components/FeaturePage.tsx`: the linked sessions are the feature's repo's
  (via `repoHead` then `repoProjectIds`), from a new `projects` prop.
- [x] `src/renderer/src/App.tsx`: pass `projects` to `FeaturePage`, and show `BoardSwitch` only
  when the shown project is not a worktree.
- [x] Run `npm test` (covers `featureUnion.test`, `repoGroups.test`, `tree.test`,
  `boardRender.test`, `projectPageRender.test`, `navigation.test`, `paletteItems.test`,
  `gridView.test`, `noInlineStyles.test`).
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Log the slice in `docs/work/2026-10-08-worktree-support/06-implementation.md`.

## Open questions

None.