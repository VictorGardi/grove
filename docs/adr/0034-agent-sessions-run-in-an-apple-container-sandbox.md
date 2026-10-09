# 0034. Agent sessions run inside an Apple `container` sandbox composed in core

Date: 2026-10-09

## Status

Proposed

## Context

Grove launches every session through one pipeline: `AgentSource.argv()` →
`loginShellArgv()` → `TmuxBackend.create()` → `tmux new-session -- argv`. tmux,
the attach clients and all of core are host processes; the pane's leaf command
is the only per-session executable.

A sandboxed session needs the agent process to run somewhere that is not the
host filesystem, with the host paths it legitimately needs exposed at the same
absolute paths. The question is where that wrapping belongs: it is a property of
how a session is launched, not of which agent it runs and not of what a pane is.

`container` also has to be found and run: a host binary, and a VM that must be
started, torn down and named so a crash leaves something identifiable.

## Decision

- **Module:** `src/core/sandbox/` builds a `SandboxSpec` (image, mounts, env,
  workdir) from the session, and `sandboxArgv` turns the agent's argv into
  `container run …`. It is composed at the seam `loginShellArgv` already owns, in
  `sessionCreate` and `sessionResume`.
- **Unchanged:** `AgentSource` (agents describe how they are invoked, not where
  they run), `SessionBackend` (a backend owns a pane, not a leaf), tmux.
- **Image:** `resources/sandbox/Dockerfile` builds `grove-sandbox:<hash>` with
  `hash = sha256(Dockerfile)` — a content-addressed local tag, built once by
  `container build` on the first sandboxed launch and reused after.
- **Lifecycle:** `--rm` covers a clean exit; `sessionKill`/`sessionRemove` run
  `container rm -f <tmuxName>` after `backend.kill`; `core.start()` prunes
  `grove-*` containers with no live tmux session. The container is named after
  the tmux name, so an orphan is traceable to its session.
- **Scope:** Claude only this round. The mount table is per agent kind, so
  another agent is one entry, not a redesign.

## Consequences

- Agents keep declaring argv; adding sandboxing did not touch either adapter.
- The host login shell still runs (ADR 0010), so `container` is found on the
  user's PATH and rc-file noise is unchanged — but the sandboxed agent gets the
  image's environment, not the user's shell environment.
- The first sandboxed session pays an image build; later ones pay ~a second of
  VM start.
- Grove depends on a third-party CLI that is young and macOS-26-oriented. Its
  availability is checked per create and fails loudly — never a silent
  unsandboxed fallback, which would be the worst possible failure mode here.
- Rejected: a sandboxed `SessionBackend` (the backend's contract is create/kill
  a pane; questions ruled this out); teaching each `AgentSource` about
  containers; `sbx`/Docker (needs Docker Desktop, seconds of startup, and a
  bind-mount throughput tax); Seatbelt/bubblewrap (kernel policy only — weaker,
  and the human chose Apple's CLI); pulling a published image (a registry grove
  would have to run and version).
- OpenCode is excluded, not forgotten. Its TUI always talks to a server, by
  default a **shared** one on `:49374` whose `url` and password are registered in
  `~/.local/state/opencode/service.json` (ADR 0005; grove reads that file at
  `src/core/opencode/client.ts:8-10,152`). Inside a container `127.0.0.1` is the
  container itself, so the TUI would start a service of its own and register it
  there. That service evicts the host's — the host service watches the file and
  exits when it stops matching — which drops status, waiting, notifications and
  write-driven linking for **every** OpenCode session on the host, not just the
  sandboxed one. Mounting the file read-only instead leaves the TUI unable to
  register at all. A per-session service with a published port is its own
  design; the per-kind mount table leaves room for it.