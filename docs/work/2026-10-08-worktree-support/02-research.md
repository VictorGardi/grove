---
phase: research
status: approved
version: 1
based_on: []
repo_heads: ["feature/xirp"]
---

# Worktree support — research

## Summary

Grove's session/diff layer is already surprisingly worktree-ready: a
session's working directory is independent of its project's registered path,
branch reading already follows a worktree's `.git` file redirect, and diff
computation already resolves the repo root from the session's own directory
rather than assuming the project's. What's entirely missing is any git
worktree *mechanics* (create/remove/list/prune), and three subsystems
(the artifact viewer's "open changed file", feature discovery, and
auto-linking) that resolve paths relative to the registered `project.path`
rather than the session's actual directory — which silently breaks for a
session whose cwd is a sibling worktree. No GUI affordance for a custom cwd
exists at all today; it's CLI-only (`grove new --cwd`).

## What already works

- **`Session.cwd`** (`src/shared/types.ts:12`; ADR 0029) is an independent,
  persisted field — `null` falls back to `project.path`, but a session is not
  required to run inside its project's path.
- **`readBranch()`** (`src/core/git.ts:6-16`) already follows a worktree's
  `.git` *file* (`gitdir: …` redirect) up to the real `HEAD`, so branch
  display works correctly for a worktree directory today.
- **Diff computation** (`src/core/diff/compute.ts:27-29`) runs
  `git rev-parse --show-toplevel` against the session's own directory
  (`o.dir`), so it finds a worktree's own root rather than assuming the
  project's. `projectScope()` (same file, line 63) scopes the `git diff`
  pathspec to the project's subtree only when it actually is one; for a
  worktree (root ≠ project.path, not an ancestor/descendant relationship) it
  correctly falls back to no scoping, i.e. diffs the whole worktree.
- **The tmux backend** (`src/core/backend/tmux.ts:43-50`) takes an arbitrary
  `cwd` with no assumption it sits under any registered project.
- **The CLI** already has `grove new --cwd DIR`, and `resolveProject()`
  (`src/core/cliOps.ts:41-55`) registers whichever repo a given folder
  belongs to (`git rev-parse --show-toplevel`) if no existing project
  contains it.

## What's missing

1. **No git-worktree mechanics exist anywhere.** A repo-wide grep for
   "worktree" only turns up the `readBranch` comment and its test — never a
   call to `git worktree add/remove/list/prune`. This needs a new module:
   creation (with branch pick/create), listing, removal, and pruning.
   Git enforces that a branch can only be checked out in one worktree at a
   time, which the app should detect proactively via
   `git worktree list --porcelain` before offering to create one, rather
   than surfacing git's raw `fatal: '<branch>' is already used by worktree
   at '<path>'` after the fact. A worktree should be `git worktree lock`ed
   while its session is live, so a stray `prune`/`gc` can't remove it out
   from under a running agent.

2. **The artifact viewer breaks for worktree sessions.** `setRendered()`
   (`src/core/diff/compute.ts:74-83`) computes each changed file's viewer
   path *relative to `project.path`* (`path.relative(project, ...)`). When a
   session's repo root is a sibling worktree directory instead of
   `project.path`, that relative path starts with `..` for every file, so
   `rendered` comes back `null` across the board — "open changed file in
   viewer" from a diff silently stops working for any worktree session whose
   worktree isn't itself the registered project path.

3. **Feature discovery is scoped per registered `Project`, not per
   session.** `resolveRoot()` (`src/core/discovery/folder.ts:19-32`) and the
   one chokidar watcher wired per project in `src/core/core.ts:258`
   (`watchers.watchRoot(root, …)`, where `root = resolveRoot(project.path, …)`)
   both key off `project.path`. A worktree session writing into its own
   `docs/work/` tree is invisible to the Features board unless that worktree
   is itself a registered project.

4. **Auto-linking has the identical gap.** `slugFor()`
   (`src/core/autolink.ts:22-32`) resolves an agent's write paths relative to
   `projectPath`, and it's called as `slugFor(paths, project.path, …)`
   (`src/core/core.ts:336`) — not the session's actual cwd. A worktree
   session's writes won't auto-link to a feature for the same root-mismatch
   reason as (2) and (3).

5. **No GUI affordance exists.** The renderer's session-creation call sites
   (searched across `src/renderer`) never pass a `cwd` — only `projectId`.
   The custom-cwd path is exercised solely by the CLI's `--cwd` flag today.
   A worktree feature needs a genuinely new dialog/flow (pick or create a
   branch, surface branch-in-use conflicts before calling `git worktree
   add`), not just unhiding an existing hidden option.

6. **The `Project` model is strictly one path ↔ one id.** ADR 0029
   deliberately rejected "every folder becomes its own project" — but that
   was about incidental subfolders cluttering the Projects tab from ad hoc
   `cd`, a different problem from a deliberate, user-initiated worktree. That
   precedent needs to be explicitly revisited for this case, not silently
   overridden.

## Design implication

Items 2–4 all fail for the same underlying reason: they resolve paths
against `project.path` instead of against wherever the session actually
runs. Teaching each of the three subsystems to resolve against `session.cwd`'s
own repo root instead is one option, but the path of least resistance is
**modeling each worktree as its own lightweight `Project`** (so
`project.path` *is* the worktree root) — that makes discovery, the watcher,
the diff viewer, and autolink all correct with no changes to any of them.
This needs `Project` to grow something like `parentProjectId`/`worktreeOf` so
the sidebar can nest a worktree under its parent repo rather than listing it
as an unrelated top-level project, plus exclusion from the generic git-top
fallback registration path in `resolveProject()`. This also matches how the
closest external analogs (Conductor, Crystal — multi-agent orchestrators
built on worktrees) work: each agent session gets its own project root, not a
sub-path of one.

## External research

- Git's one-branch-one-worktree rule is the central UX problem to design
  around; check `git worktree list --porcelain` before creating, don't just
  react to a failed `add`.
- Submodules are not auto-initialized in a new worktree (`git submodule
  update --init --recursive` is a required follow-up step) — a known rough
  edge.
- Each worktree needs its own `node_modules`/build output since it's a fully
  separate working directory; pnpm's global virtual store (symlinked
  per-worktree content from one real store) is the documented fix, and is
  explicitly framed by pnpm around this exact multi-agent-sessions use case.
  Don't naively share one `node_modules` across worktrees — dependency trees
  can diverge per branch.
- GitHub Desktop has no worktree support; the commonly cited reason is that
  its repository model assumes `.git` is a directory at the repo root, which
  a linked worktree's `.git` *file* redirect breaks.
- VS Code (1.103, mid-2025) and JetBrains IDEs (2025.1+) both added native
  create/open/delete-worktree UI, opening each worktree as its own
  window/project root — validating "separate root per worktree" as a
  mainstream pattern, not just an AI-tool-specific hack.
- Recommended cleanup policy from the ecosystem: keep-until-merged/explicit
  close, not auto-remove on session end — agents' work often needs review
  after the session ends, and a premature `worktree remove` risks losing an
  unreviewed diff.
- Comparable tools surveyed: Conductor (conductor.build), Crystal/Nimbalyst
  (stravu/crystal), container-use (dagger/container-use, worktree + per-agent
  container), Graphite's multi-worktree docs, and CLI-only wrappers
  (Worktrunk, `gwt`, `gwq`, `git-worktree-switcher`).

## Relevant ADRs

- **ADR 0020** — sessions-and-review-before-workflow; the original
  "one checkout per project" scoping decision this investigation revisits.
- **ADR 0021** — session-diff-in-app-from-git-cli; diff computation already
  resolves root from the session's own directory (see above).
- **ADR 0022** — viewer-serves-project-files; the `FileTarget`
  `{projectId, path relative to project.path}` contract that breaks for a
  worktree session's files (see "what's missing" item 2).
- **ADR 0029** — session-cwd-and-launch-prompt; `Session.cwd` as an
  independent field, and the "no subfolder becomes its own project"
  precedent that a worktree-as-project design would need to distinguish
  itself from.

## Complexity verdict

Medium-sized feature, roughly comparable in scope to ADR 0021 (session diff)
or ADR 0027 (grove CLI). Not a rearchitecture — the hard part (sessions
decoupled from a single project path, branch-aware diffing) is already
built. The net-new work is: a from-scratch git-worktree lifecycle module, a
`Project` schema extension plus a config migration (same pattern as the
state-file v3→v4 bump for `cwd`), and a genuinely new GUI flow for
creating/managing worktree sessions with branch-conflict handling.

## Open questions

See `00-ticket.md`'s "Decisions chosen" section — a real questions phase
(`01-questions.md`) hasn't been run yet, so none of those product questions
are resolved.
