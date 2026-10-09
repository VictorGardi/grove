# 0035. A sandbox binds its mounts at host-identical paths, and only what a session needs

Date: 2026-10-09

## Status

Proposed

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
- **Mount set** (rw, Claude): the session's working directory; `~/.claude` and
  `~/.claude.json`; `~/.gitconfig`; the Claude spool directory under `userData`;
  and the `grove.sock` file. Nothing else.
- **Everything else is absent**, not merely unread: no other project, no
  `~/.ssh`, no `~/Library`, no system directories. The host filesystem outside
  those paths does not exist in the container's view.
- **Env** is explicit and short: `GROVE_SESSION_ID`, `GROVE_SOCKET`,
  `TERM=xterm-256color`. No host environment is forwarded.

## Consequences

- Diff, discovery, autolink, the viewer, the branch field and the spool keep
  working unchanged for a sandboxed session, because nothing new has to learn
  about paths.
- `~/.claude` is read-write, so a sandboxed session can still read its own
  credentials and settings, and can write history. That is the one place the
  sandbox can reach outside its working directory, and it is the agent's own
  directory by construction.
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