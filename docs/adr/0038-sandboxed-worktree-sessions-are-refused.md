# 0038. A sandboxed worktree session is refused until the mount set gains the git common dir

Date: 2026-10-10

## Status

Superseded by [0035](./0035-sandbox-binds-mounts-at-identical-host-paths.md)

## Context

ADR 0035 made the sandbox's mount set exactly the session's working directory, at
host-identical paths, because every host subsystem resolves against those paths.

A worktree breaks that assumption. A worktree's `.git` is a *file* reading
`gitdir: /Users/victor/git/grove/.git/worktrees/wt-probe` — a path outside the
mount. Measured against real `container` 1.5.0: mounting the worktree alone gives
`fatal: not a git repository: (null)` for every git command. Mounting the worktree
**and** the main repo's common dir, both at host-identical paths, works completely
— `rev-parse --show-toplevel`, `--git-common-dir`, and a real `git commit` the host
then sees (`02-research.md` § *A sandboxed agent working in a git worktree*).

The failure is silent, and only on the host-visible side. grove's core never enters
the sandbox: discovery, the watcher, diff and auto-link run on the host and keep
working. The session card shows a sandbox tag, a real branch and a real diff, while
the agent cannot commit anything.

The sandboxing design recorded the opposite — "Worktrees | Untouched — a worktree is
just another `Session.cwd` to mount" (`03-design.md:198`) — and its slice 1 manual
verify (`04-structure.md:31-39`) runs no git command, so the bug would have shipped
undetected.

## Decision

Superseded. ADR 0035 now carries the rule: the mount set is the session's working
directory **plus**, when that directory is a linked worktree, the repository's git
common dir, with `.git/hooks` and `.git/config` read-only, derived by
`gitCommonDir(dir)` with no process spawn.

## Consequences

- The design-level blocker is gone. A sandboxed worktree session is a **supported**
  combination rather than a refused one, so this ADR no longer withholds anything.
- The principle it was written to protect still binds, and now lives in the
  sandboxing design's two-way table: **the worktree mount path must not ship until
  slice 1 proves `git rev-parse --show-toplevel` and a real `git commit` work
  inside the mount.** That obligation is structural, not architectural, which is why
  it is a row in `04-structure.md` rather than an ADR.
- `--read-only-path` is Experimental and two behaviours are unmeasured: whether it
  tolerates an absent path (`~/.gitconfig` may not exist) and whether it survives two
  nested carve-outs in one read-write volume. Slice 1 settles both; if either fails,
  ADR 0035's mount shape changes.
- `core.hooksPath` is neutralised by env (`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`),
  which converts the measured hook-execution property from a documented risk into a
  decision. A repository that legitimately uses `core.hooksPath` stops running hooks
  inside the sandbox — the same class of divergence as shipping no rc files.
- **Rejected, and still rejected:** leaving the worktree mount implicit, which is how
  the incorrect table row came to be.