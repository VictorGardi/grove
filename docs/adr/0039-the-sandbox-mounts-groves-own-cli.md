# 0039. The sandbox mounts grove's own CLI, read-only, so a sandboxed agent can still drive grove

Date: 2026-10-11

## Status

Superseded by [0045](./0045-sandboxing-is-left-to-each-provider.md)

## Context

[ADR 0035](./0035-sandbox-binds-mounts-at-identical-host-paths.md) fixed the sandbox's
mount set: the working directory, the agent's config dirs, the Claude hook spool, and the
`grove.sock` file, with `GROVE_SOCKET` and `GROVE_SESSION_ID` in the container's env. That
was coherent — but it shipped **a socket with no client**.

Inside the container there is no `grove` executable. The only launcher grove writes lives
in `binDir` and execs the app's own macOS Electron binary as Node (ADR 0028), which D1
excludes from the sandbox because macOS binaries cannot run in a Linux container. So every
command that speaks the socket protocol — `ls`, `new`, `send`, `wait`, `read`, `focus`,
`kill`, the surface ADR 0027 froze as a contract — was unavailable to a sandboxed agent,
while the socket and both environment variables sat there mounted and inert.

Two things make this a real gap rather than a cosmetic one:

- The questions phase answered it explicitly. Q5 chose "bind-mount everything needed …
  keeps all current features working (hooks, `grove` CLI, status line)", and the option
  "bind-mount only hook-spool — keeps Claude event streaming, **loses `grove` CLI**" was
  offered and not taken. The design recorded the intent and then failed to deliver it.
- Orchestration is worth *more* inside a sandbox, not less. A sandboxed agent that can
  `grove new claude --sandboxed --cwd <other> --prompt …` puts the risky work in a second
  session with its own mount set — which is exactly what the feature is for. Removing the
  capability removes the cheapest way to use it.

Everything host-side was unaffected, and it is worth being precise about that, because it
is why the bug is easy to miss: status, waiting-for-human, notifications, the context
gauge, write-driven autolink, discovery and the diff are all host-side readers keyed on
`project.path` and the spool file. A sandboxed session looked completely healthy. Only
agent-initiated orchestration was gone.

## Decision

Superseded. Grove removed sandboxed sessions and leaves isolation to each agent provider; [ADR 0045](./0045-sandboxing-is-left-to-each-provider.md) records it. The decision below is kept for history.

- **Mount `out/main/cli.js` read-only, at its host path**, adding one `--volume` to the
  set in ADR 0035. Same-path invariant preserved; nothing new has to learn to resolve it.
- **The image carries a `grove` shim**, not the bundle. `resources/sandbox/Dockerfile`
  installs `/usr/local/bin/grove` that does `exec node <cliBundle> "$@"`. This is the
  same pattern the image already uses for `jq`, which exists solely for the ADR 0032
  statusline hook.
- **Mounted, not baked.** The image tag is a hash of the Dockerfile only, so a grove
  upgrade changes the bundle without invalidating the image. Baking would force a rebuild
  on every release for no behavioural gain.
- **`binDir` stays unmounted.** The host launcher is macOS-only and has no business in a
  Linux container; only its job — putting a `grove` on `PATH` — is reproduced, in the
  image.
- **`package.json` gains `out/main/cli.js` to `build.asarUnpack`.** In `electron-vite dev`
  the bundle is already a real file; a packaged build would otherwise leave it inside
  `app.asar`, which `--volume` cannot bind.

## Consequences

- A sandboxed agent gets the whole ADR 0027 surface, unchanged, including exit codes and
  `--json`, because it is the same implementation — not a second one.
- The image already carried a Node runtime, since it installs pinned agent npm globals.
  D7 therefore costs a read-only bind mount, a three-line shim, and one packaging entry.
  It adds no dependency and no build step.
- Read-only is the correct mode and is not merely tidy: the bundle is code that grove
  executes on the agent's behalf, and an agent that could rewrite it could rewrite its own
  client.
- `GROVE_SOCKET` and `GROVE_SESSION_ID` stop being decoration. ADR 0035 mounted them
  "so the CLI can run"; they now have something to run.
- Rejected: **dropping the CLI** — the simplest option, and what this design recorded by
  omission until 2026-10-11, but it contradicts the recorded Q5 decision and removes the
  capability precisely where it is most useful.
- Rejected: **a separate minimal Linux client**. The wire protocol is one JSON line per
  connection, so a bespoke client is easy to write, and it would fork ADR 0027's frozen
  command surface and exit-code contract into a second implementation that silently drifts
  from the TypeScript one. Reuse is cheaper than parity.
- Rejected: **baking the bundle into the image**. Couples the tag to grove's release
  cadence, for identical behaviour.
- Not affected: ADR 0036's filesystem-only posture. The CLI talks to a Unix socket inside
  the sandbox's own namespace; no new network surface is introduced.