# 0035. A sandbox binds its mounts at host-identical paths, and only what a session needs

Date: 2026-10-09

## Status

Accepted

## Context

Everything Grove does host-side — the diff (ADR 0021), feature discovery,
autolink, the artifact viewer, the branch read, and the Claude hook spool tail
(ADR 0016) — resolves a session's directory as a **real host path**. The Claude
spool path in particular is baked into the launch argv as literal text and
appended to from inside the pane; `GROVE_SOCKET` is a host path the CLI refuses to
run without (ADR 0027).

So the sandbox has to expose host paths at the same absolute paths they occupy on
the host, or a large part of the app silently stops working for sandboxed
sessions. At the same time the whole point is that the agent cannot reach the
rest of the machine — which means the mount set cannot simply be "everything
useful".

## Decision

- **Same-path invariant:** every `--volume` is `hostPath:hostPath`. A container-
  only path (`/workspace`) is never used.
- **Mount set** (rw): the session's working directory; `~/.claude` and
  `~/.claude.json`; OpenCode's `~/.local/share/opencode` and
  `~/.config/opencode`; the Claude spool directory under `userData`; and the
  `grove.sock` file. Nothing else.
- **A worktree adds its repository's git common dir** (rw), with `.git/hooks` and
  `.git/config` read-only, and only when the working directory *is* a linked
  worktree. Measured: a worktree's `.git` is a *file* naming
  `<main>/.git/worktrees/<name>`, a path outside the mount, so mounting the
  worktree alone gives `fatal: not a git repository: (null)` for every git
  command. Mounting both, at host-identical paths, works completely. The common
  dir is a sibling inside the same repository, not an extra root, so the
  same-path invariant is untouched. It is derived by `gitCommonDir(dir)`, which
  reads the `.git` file with no process spawn.
- **Read-only mounts**, via `container run --read-only-path`:
  `~/.local/state/opencode`, because a sandboxed OpenCode must never write its
  own `service.json` (ADR 0034); `~/.gitconfig`, because an agent that can write
  it can set `core.hooksPath` for **every unsandboxed git run on the host**
  afterwards; and a worktree's `.git/hooks` + `.git/config`.
- **Git hooks are neutralised by env, not by permissions.** `GIT_CONFIG_COUNT=1`,
  `GIT_CONFIG_KEY_0=core.hooksPath`, `GIT_CONFIG_VALUE_0=<empty dir in the image>`.
  Git applies `GIT_CONFIG_*` at command-line scope, so it beats `~/.gitconfig`
  and `.git/config` for every git invocation in the pane. Read-only denies
  *editing* hooks, not *executing* one — measured, a host `post-checkout` hook ran
  inside the sandbox as `uid=0` with `hooks/` read-only.
- **Everything else is absent**, not merely unread: no other project, no
  `~/.ssh`, no `~/Library`, no system directories. The host filesystem outside
  those paths does not exist in the container's view.
- **Env** is explicit and short: `GROVE_SESSION_ID`, `GROVE_SOCKET`,
  `TERM=xterm-256color`, plus the three `GIT_CONFIG_*` above. No host environment
  is forwarded.

## Consequences

- Diff, discovery, autolink, the viewer, the branch field and the spool keep
  working unchanged for a sandboxed session, because nothing new has to learn
  about paths.
- `~/.claude` is read-write, so a sandboxed session can still read its own
  credentials and settings, and can write history. OpenCode's share and config
  directories are read-write for the same reason; its **state** directory is the
  one read-only mount, because a sandboxed TUI that could write its
  `service.json` would register a second service and evict the host's (ADR 0034).
- The user's shell environment, version managers and dotfiles are not available
  inside. A sandboxed session is a plain Linux box with the agent, `git`,
  `ripgrep` and `jq`. That is a deliberate difference from an unsandboxed
  session, and it is the isolation.
- Rejected: a `/workspace` remap (breaks the spool path, the socket path, the
  diff directory and autolink in one stroke, and would need path translation in
  every host subsystem); mounting all of `$HOME` (hands over SSH keys and every
  credential store for every other project); read-only mounts for the config
  dirs (Claude and OpenCode both write session history and state there).
- Unresolved, and the reason the first slice is a manual tracer: whether a
  single-file mount of the `grove.sock` Unix socket works. If it does not, the
  fallback is mounting the whole `userData` directory, which widens this set and
  needs its own decision.