# 0037. A git worktree is its own Project, and Project.path keeps meaning one checkout

Date: 2026-10-10

## Status

Accepted

## Context

ADR 0020 deferred "worktrees per session" so parallel sessions stop sharing one
checkout and one branch. ADR 0029 gave `Session.cwd` an independent, persisted
directory and deliberately refused to make every folder a project.

Those two together leave a gap. Several subsystems resolve paths against
`project.path` rather than against wherever a session actually runs: the diff
viewer's rendered paths (`src/core/diff/compute.ts:74-83`), feature discovery and
its watcher (`src/core/core.ts:247-265`), auto-linking (`src/core/core.ts:341-342`),
and the artifact viewer's containment check
(`src/core/artifacts/path.ts:6-17`). For a session in a worktree they all break
together, for one reason: `project.path` is the main checkout, not the directory the
agent is in.

The questions phase answered "plain `Session.cwd`, keep one Project per repo". Three
things overturned that:

- Its own research already argued the other way (`02-research.md` § *Design
  implication*), and the answer overrode it.
- Multi-repo sandboxing makes it load-bearing. The sandbox mounts exactly the
  session's working directory at host-identical paths (ADR 0035), an invariant that
  only holds if that directory *is* a project path.
- The approved disk location, `~/.grove/worktrees/<repo>/<branch>`, already forces
  it in code. `resolveProject` matches by path containment only
  (`src/core/cliOps.ts:37,48-51`) and falls back to `git rev-parse --show-toplevel`
  (`src/core/core.ts:156-163`), which inside a worktree returns the worktree root.
  grove therefore already registers a Project per worktree, and collapses
  `Session.cwd` to `null` (`core.ts:627-628`). The plain-`Session.cwd` answer was
  unreachable, not merely unfashionable.

## Decision

A worktree is a `Project` whose `path` is the worktree root. `Project` grows one
**optional** field, `worktreeOf?: string`, naming the parent project for **nesting
only** — it is never the authority for which repository a checkout belongs to. That
authority is `gitCommonDir(dir)`, derived from git at load.

Feature identity is (repo group, slug): the board shows one card per feature, the
parent checkout's copy is canonical, and a divergent worktree copy is surfaced by a
chip rather than by a duplicate card.

## Consequences

- The four subsystems above are correct with **no change**, because `project.path`
  is the directory the agent runs in. `runDiff`'s gone-session fallback
  (`core.ts:415`), which resolves against `project.path` rather than `Session.cwd`,
  also becomes correct rather than silently diffing the main checkout.
- A worktree session is reachable from the GUI with no IPC change: `session:create`
  carries no `cwd` (`src/shared/ipc.ts:15`), and the worktree is a project.
- `config.json` stays at `schemaVersion: 1`. The field is additive-optional, and
  `readVersioned` returns parsed keys verbatim (`jsonFile.ts:31`);
  `Session.lastFocusedAt?` is the precedent. No migration, and no exposure to the
  rename-aside at `jsonFile.ts:36-39`.
- Repo grouping cannot dangle, cannot be absent, and self-corrects against a
  hand-edited config, because it is recomputed from git rather than remembered.
- Features are discovered once per checkout, so `features.items` holds one record per
  (checkout, slug) and the renderer collapses them. Two chokidar handles per checkout
  (`core.ts:257,264`), linear in worktree count.
- ADR 0029's precedent is narrowed, not overturned: only a *deliberate, grove-created*
  worktree becomes its own Project; incidental subfolders still do not.
- **Rejected: plain `Session.cwd` under the existing project.** Needs four subsystems
  fixed, gives the viewer no session-scoped root (`ui.viewer` is one global panel),
  and is unreachable while worktrees live outside the repo directory.
- **Rejected: `Project { checkouts[] }` with a `Checkout` type.** It deletes
  `project.path` and so reinstates exactly the root field ADR 0032 rejected
  (`0032:41-42`); it adds a second identity that can disagree with `projectId`, and
  the disagreement is silent (a draft-anchor collision at `core.ts:308`; wrong line
  numbers shipped to the agent at `comments/anchor.ts:83-84`); and `checkouts[]`
  cannot represent a monorepo subtree, which `git worktree add` cannot create.
## Amendment (2026-10-12): the sidebar no longer nests worktrees

`worktreeOf` is still how a worktree is tied to its repo, but the Sessions tab no longer draws
a worktree as a sub-group. Its sessions sit in the repo's group, sorted with the rest, and a
card in a worktree carries a purple worktree icon in its bottom-right corner. The Projects tab
lists repos only. Nothing in the data model changed.
