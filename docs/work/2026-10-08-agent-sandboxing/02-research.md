---
phase: research
status: draft
version: 1
based_on: []
repo_heads: ["feature/xirp"]
---

# Agent session sandboxing — research

## Summary

Grove's session-launch path already has a clean seam for this: the backend
interface takes an arbitrary command line, so sandboxing a session is a
matter of substituting what gets run inside that one wrapper, not building a
new backend. The real design question is which isolation mechanism to wrap
it with — an OS-level sandbox (macOS Seatbelt / Linux bubblewrap, the
mechanism behind Claude Code's own built-in `sandbox` setting), a full
container/microVM via `sbx` (Docker's "Docker Sandboxes" product — the same
infrastructure this research session itself runs under), or Apple's newer
native `container` CLI. Each has a materially different latency, isolation
strength, and integration-complexity profile; none require a new session
backend.

## The integration seam in Grove

- `TmuxBackend.create()` (`src/core/backend/tmux.ts:43-50`) takes an
  arbitrary `{ name, cwd, argv, env }` and runs
  `tmux new-session -c <cwd> -- <argv>`.
- The final `argv` is already built by wrapping the agent's own argv in a
  login shell before it reaches the backend: `loginShellArgv()`
  (`src/core/env.ts:42`, `bash -l -i -c 'exec ...'`), called from
  `core/core.ts:634-637` (`backend.create({ ..., argv, env: cliEnv(session) })`).
- **Sandboxing doesn't need a new `SessionBackend`.** It's a matter of
  substituting what gets `exec`'d inside that one wrapper command — tmux's
  own server, node-pty, and the rest of Grove's process tree stay completely
  outside any sandbox; only the leaf agent process is confined. That matches
  exactly how Seatbelt/bubblewrap/`sandbox-exec` expect to be used (wrap one
  `exec`, not a process tree).
- Two things need to be reachable inside whatever sandbox is used, at
  identical paths, for existing features to keep working: the Claude
  hook-spool file (`<userData>/agents/claude/<id>.jsonl`, written by inline
  shell snippets Claude's own hooks execute — `src/core/claude/hooks.ts`) and
  Grove's control socket (`<userData>/grove.sock`, `GROVE_SOCKET`) if the
  session should keep `grove` CLI access.
- Grove's diff/discovery/autolink machinery (see
  `../2026-10-08-worktree-support/02-research.md`) all run host-side against
  the session's directory independent of the agent process, so — same as
  with worktrees — whatever sandboxing approach is used must leave that
  directory as a real, host-visible path. A bind-mount-based approach (Docker,
  `sbx`, Apple's `container`) satisfies this with an exact path mapping; an
  OS-level sandbox (Seatbelt/bubblewrap) sidesteps the question entirely,
  since there's no container boundary and the real host path is used as-is.

## Options surveyed

### OS-level sandboxing (macOS Seatbelt, Linux bubblewrap)

No container, no VM, no image; near-zero startup overhead; no bind-mount
translation problem since the real host path is used directly. This is the
mechanism behind Claude Code's own built-in sandbox: a `sandbox` block in
`settings.json` (filesystem allow/deny lists, network allow-list, credential
masking), enforced via Seatbelt on macOS and bubblewrap on Linux, reportedly
through a reusable Anthropic package (`@anthropic-ai/sandbox-runtime`) —
name/availability not independently verified here, worth confirming before
depending on it. One real caveat: Claude Code's own sandbox setting wraps its
**Bash tool subprocess only** — its Read/Write/Edit file tools and MCP
servers aren't routed through it. For "sandbox the whole argv" (wrapping the
entire `claude`/`opencode` process, not relying on the CLI's internal tool
routing), that distinction doesn't matter, but it means flipping Claude's own
setting isn't sufficient on its own — driving the underlying Seatbelt/bwrap
primitive directly (or via that SDK, if real) is the actual mechanism needed.
Network control is coarser than a container's (deny-all vs. an allow-list,
typically paired with a local proxy for per-host granularity) and macOS's
`sandbox-exec` is marked deprecated in its own man page, though still shipped
and reportedly still what Claude Code's lighter mode itself uses today.

### `sbx` (Docker Sandboxes CLI)

This is the same sandboxing product this very research session's own
environment runs under — its `DOCKER_SANDBOXES_IP_STACK` env var and
`sbx policy`/`sbx secret`/`sbx ports` surface are Docker's own "Docker
Sandboxes" tooling (see https://docs.docker.com/reference/cli/sbx/ — not
independently fetched/verified in this research pass), not something
Claude-Code-specific. Fully scriptable: `sbx run --name <id> <cmd> <dir>`
(with `:ro` mounts for read-only paths), `sbx exec` for running arbitrary
commands inside an existing sandbox, `sbx policy allow/deny network <host>`
for egress control, `sbx rm`/`sbx stop`/`sbx prune` for teardown. Bind-mount
path mapping is exact (`-v hostpath:containerpath`, same path both sides
works). Trade-offs: needs Docker/KVM running; per-session startup is low
seconds once the Docker VM is already warm (not a one-time cost if Docker
Desktop isn't already running in the background); bind-mount throughput
across the macOS↔VM boundary has a measurable tax on many-small-file
workloads — relevant for "a lot of code generation," the exact case this is
for.

### Apple's native `container` CLI — the human's preferred direction

A lightweight per-container VM via Apple's Virtualization framework with a
purpose-built init (`vminitd`), no Docker Desktop daemon needed — each
container's VM spins up on demand and disappears when the container exits.
Reported sub-second container starts, the best latency story of any
container-based option surveyed, with real host-directory volume mounts
(`container run -v`) giving the same exact path-mapping guarantee as Docker.
Trade-offs: Apple Silicon + recent macOS only (fine for a macOS-only app);
the tool is young (1.0 landed within the past year), so its network-isolation
tooling and image ecosystem are thinner/less proven than Docker's, and
fine-grained egress allow-listing is less documented. Given the human's
interest in this option: it sits between OS-level sandboxing and `sbx` on
the latency/isolation-strength spectrum — real container/VM isolation
(stronger than Seatbelt/bwrap's kernel-policy approach) without Docker
Desktop's background footprint — and is worth prototyping directly rather
than only as a fallback, with the main open risk being how solid its network
controls prove under real use and how much image/tooling friction shows up
day to day.

### Not recommended as direct dependencies

- **devcontainers spec/CLI** — pure config-resolution overhead on top of
  Docker/Apple's `container`; built for persistent, declaratively-configured
  environments, not a disposable per-session jail. Adds no bind-mount or
  network primitive beyond scripting the underlying runtime directly.
- **dagger's `container-use`** (github.com/dagger/container-use) — the
  closest prior art (git worktree + per-agent container), but it wants to
  *own* the git workflow (creates its own branch per environment), which
  conflicts with Grove already owning `Session.cwd`/worktree lifecycle
  (see the worktree-support research). Its isolation unit is a Dagger
  container, so it adds the Dagger engine (a BuildKit-based daemon) as a
  layer on top rather than removing a dependency.
- **e2b.dev / Daytona / Modal** — built for cloud-hosted agent backends.
  E2B's self-hostable stack needs Firecracker/KVM, which can't run natively
  on a Mac host without nested Linux virtualization. Daytona's self-host
  story narrowed in 2026 (control plane went closed-source) and it still
  uses Docker underneath. Modal has no self-host path. None fit a local,
  optional, per-session desktop-app use case.

## Design implication

Whichever mechanism is chosen, the Grove-side shape is the same:

- A new per-session opt-in, not default-on (matching "only heavier
  sessions") — a `Session.sandboxed` flag (or similar), surfaced as a toggle
  at session-creation time; same schema-migration pattern as the past
  `cwd` field bump (ADR 0029).
- A small new module building the sandbox invocation: read-write on
  `session.cwd` (ideally a dedicated worktree — see
  `../2026-10-08-worktree-support/`, giving the sandbox a clean, disposable
  writable root instead of the shared project checkout), read-write on the
  hook-spool path and Grove socket, default-deny network except the agent's
  own API host(s) and (for OpenCode) its local HTTP server port.
- Teardown is close to free with the OS-level or Apple `container` route —
  ends when the wrapped process exits; `sbx`/Docker needs explicit
  `rm`/`prune` bookkeeping instead.

## Complexity verdict

Smaller than the worktree feature if OS-level sandboxing or Apple's
`container` CLI is the route: one new argv-wrapping module, a UI toggle, and
a schema field — no new `SessionBackend`. Grows meaningfully if `sbx`/Docker
ends up necessary (persistent background state, explicit teardown lifecycle,
bind-mount throughput caveats on code-gen-heavy sessions). Given the human's
lean toward Apple's `container` CLI: recommend prototyping it directly
first — it offers real container/VM isolation at close to OS-level sandbox
latency, without Docker Desktop's footprint — and keep OS-level sandboxing
and `sbx` as fallbacks if its network controls or day-to-day tooling prove
insufficient.

## Open questions

See `00-ticket.md`'s "Open for the questions phase" section — a real
questions phase (`01-questions.md`) hasn't been run yet, so none of those
product questions are resolved.
