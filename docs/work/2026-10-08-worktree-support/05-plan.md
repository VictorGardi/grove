---
feature: 2026-10-08-worktree-support
phase: plan
status: approved
version: 1
created: 2026-10-10
updated: 2026-10-10
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Worktree support — plan

Self-approved per slice by grove-implement: mechanical checks passed, not
human-reviewed.

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

## Open questions

None.