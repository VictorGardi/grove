# 0034. Agent sessions run inside an Apple `container` sandbox composed in core

Date: 2026-10-09

## Status

Superseded by [0045](./0045-sandboxing-is-left-to-each-provider.md)

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

Superseded. Grove removed sandboxed sessions and leaves isolation to each agent provider; [ADR 0045](./0045-sandboxing-is-left-to-each-provider.md) records it. The decision below is kept for history.

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
- **Scope:** both agent kinds. The mount table is per agent kind, so an agent is
  one entry, not a redesign.
- **OpenCode's shared service (D6):** before the first sandboxed OpenCode
  session, grove writes `{"hostname":"<bridge>"}` once into the service config,
  binding the host's shared service to the **container bridge address only**,
  and the container's `~/.local/state/opencode` is mounted **read-only**
  (`--read-only-path`). Never `0.0.0.0`. The address is **discovered**, not
  assumed (`container network ls --format json` → `.status.ipv4Gateway` of
  network `default`), and grove starts the container system and **waits with
  backoff** for the bridge, which does not exist for the first ~2½ minutes after
  login — `Errno 49`/`EADDRNOTAVAIL` is not-ready-yet, and only a failure past the
  retry budget refuses. See "Corrections" below.

## Consequences

- Agents keep declaring argv; adding sandboxing did not touch either adapter.
- The host login shell still runs (ADR 0010), so `container` is found on the
  user's PATH and rc-file noise is unchanged — but the sandboxed agent gets the
  image's environment, not the user's shell environment.
- The first sandboxed session pays an image build; later ones pay ~a second of
  VM start (measured 14 s cold, 0.7 s warm, 2026-10-10).
- Grove depends on a third-party CLI that is young and macOS-26-oriented. Its
  availability is checked per create and fails loudly — never a silent
  unsandboxed fallback, which would be the worst possible failure mode here.
- Rejected: a sandboxed `SessionBackend` (the backend's contract is create/kill
  a pane; questions ruled this out); teaching each `AgentSource` about
  containers; `sbx`/Docker (needs Docker Desktop, seconds of startup, and a
  bind-mount throughput tax); Seatbelt/bubblewrap (kernel policy only — weaker,
  and the human chose Apple's CLI); pulling a published image (a registry grove
  would have to run and version).
- **OpenCode is supported, and that needed measuring first.** Two spikes on
  2026-10-10 (`02-research.md` § Spikes). First: the service binds `127.0.0.1`
  only, and a second registration into the same `service.json` **evicts the
  incumbent silently** — within 3 s of a second service sharing one
  `XDG_STATE_HOME`, the first was gone with no listening socket and no log line.
  A containerized TUI cannot reach a loopback service, so it would start its own
  and evict the host's, dropping status, waiting, notifications and write-driven
  linking for every OpenCode session on the host. Second: the bind address is
  configurable, a container's gateway (`192.168.64.1`) answers on it, and the
  `Basic opencode:<password>` grove already holds turns `401` into `200`. So the
  host service is bound routably and the container's copy is read-only: the
  sandbox joins the host's service and can never register over it.
- The cost is that the shared OpenCode service listens beyond loopback for
  anyone who can reach the container bridge — a private VM subnet, not the LAN —
  and the container is handed `OPENCODE_SERVER_PASSWORD` from the registration
  file. That moves the secret from a `0600` unix socket onto a link-scope
  virtual interface: bounded, since `bridge100` has no route from the LAN and LAN
  isolation was measured from both directions, but a weaker boundary than
  grove's own CLI transport (ADR 0035). It stays password-authenticated, and
  grove writes the change once, at the first sandboxed OpenCode session. A third
  spike measured that the first draft of this decision (`0.0.0.0`) also exposed
  the service on the host's LAN address, advertising it in the service's own
  `urls`; the bridge-scoped bind does not, and the LAN address refuses
  connections. Rejected instead: leaving OpenCode unsandboxed (measured false —
  it *is* reachable), a per-session service with a published port (a second
  service is exactly what evicts), and `0.0.0.0` (measured to reach the LAN).

## Corrections, 2026-10-11

Four spikes corrected five facts in the D6 decision above. The mechanism — bind the host
service to the container bridge, never `0.0.0.0` — survived; the human re-confirmed it,
with Apple's pf-redirect DNS recorded as the documented fallback.

- **The gateway is derived, not hardcoded.** `container network ls --format json` →
  `.status.ipv4Gateway`. A network created with `--subnet 10.99.0.0/24` yields
  `10.99.0.1`, so `192.168.64.1` is this host's coincidence.
- **The earlier `Errno 49` was a startup race, not a network change.** `bridge100` is
  created by `container system start`, measured 2m24s after boot. A host-side bridge bind
  is undocumented by Apple, so its failure is expected behaviour.
- **The image pinned the wrong major version.** `opencode-ai@2.x` does not exist on npm;
  the package was renamed and rescoped to `@opencode/cli` (signature-verified, a
  self-contained Bun binary, glibc only). v2 also **removed `opencode attach`** — the seam
  is the global `--server <url>` flag, and a 1.x client against a 2.x server is rejected.
  Minor version skew is *tolerated* on that path (it warns and proceeds), so grove must
  not bake the host's version into a content-addressed image.

Ruled out with evidence, not to be re-derived: a **unix-socket transport** (the server
config rejects every socket-shaped key, and the client rejects `unix://` at dispatch with
zero connection attempts reaching a live listener); **`socat` on the bridge** (already
reported broken in apple/container#346); and **a container→host DNS name** (all the usual
candidates NXDOMAIN). The fallback, Apple's `container system dns create <domain>
--localhost <ip>`, keeps the service on loopback but costs `sudo`, disables iCloud
Private Relay, is removed on macOS restart, and redirects whole-IP and all-ports — which
is why it is the fallback and not the default.