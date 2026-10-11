---
feature: 2026-10-08-agent-sandboxing
phase: implementation
status: draft
version: 3
created: 2026-10-10
updated: 2026-10-11
based_on:
  - 03-design.md@7
  - 04-structure.md@4
forced: []
---

# Agent session sandboxing — implementation

## Finding: a sandboxed Claude session cannot authenticate on macOS as designed

**This is a design gap, not a slice bug, and it needs the human before slice 1 is verified.**

The container runs the real agent — Claude Code v2.1.296 starts in the sandbox, reads the
mounted `~/.claude` and `~/.claude.json`, and renders its full TUI — and then stops at
**"Select login method"**.

Cause, measured 2026-10-11 on this Mac:

- There is **no** `~/.claude/.credentials.json` on the host — Claude Code keeps its OAuth token
  in the **macOS Keychain**, which a Linux VM cannot read.
- The design's Container spec mounts `~/.claude` and `~/.claude.json` and says nothing about
  credentials, so nothing grove mounts carries a token.
- The image is per design: `node:22-slim` plus `git ripgrep jq ca-certificates` and the two
  pinned agent globals. No token is baked in, and none should be.

Consequence: the first sandboxed Claude session on a Mac needs **one interactive login inside
the container**. That writes `~/.claude/.credentials.json` into the mounted `~/.claude`, so
every later sandboxed session — host and sandbox — shares it. But nobody should have to do
that by accident, and grove cannot automate an OAuth login.

Options are a design decision (documented one-time login; refuse `no-sandbox` when no
credentials are mounted; or something else), so it goes to `grove-design
2026-10-08-agent-sandboxing` in revise mode. **Nothing was changed in the artifacts to work
around it.**

Everything else in slice 1 verified, including the obligations ADR 0038 and D7 left.

## Measured 2026-10-11, macOS 26.4.1, `container` 1.5.0

`grove new claude --sandboxed --prompt "print pwd"`, image `grove-sandbox:cbcd1e51f27a`
built on first use in ~7 s (warm layers), container `grove-ff5c2579-…` running in 192.168.64.47.

The argv grove composed, read back off the tmux pane's start command, matched the design's
Container spec exactly: `--rm -i -t --name <tmuxName> --workdir <cwd>`, host-identical
`--volume`s for the working directory, `~/.claude`, `~/.claude.json`, the hook spool, the socket
and the CLI bundle; `--read-only-path` for `~/.gitconfig` and the CLI bundle;
`-e GROVE_SESSION_ID -e GROVE_SOCKET -e TERM=xterm-256color`; the three `GIT_CONFIG_*`;
`-e GROVE_CLI_BUNDLE=…`; then the image, then the agent argv. No `.git` volume and no
`hooks`/`config` carve-out, correctly — this is a plain checkout, so its common dir already
sits inside the mounted working directory.

Run with grove's exact mount set and env, a shell in place of the agent:

| Check | Result |
| --- | --- |
| working directory at the host path | `/Users/victor/git/grove`, project contents present |
| host home | `~/.ssh` absent; `/root` is the container's own, nothing of the Mac in it |
| a write outside the mount set | created `/root/Library/nope` inside only — the host never saw it |
| **`grove ls` (D7)** | **answers from inside**, over the mounted socket, via the baked shim |
| egress to the model (D5) | `api.anthropic.com` reached, HTTP 401 |
| host loopback (D5) | host ports 49152 / 5000 / 7000 all `ECONNREFUSED` |
| read-only mounts | `~/.gitconfig` byte-identical after a write attempt; `out/main/cli.js` `EROFS` |
| hook spool | writable from inside, which is what the hooks need |
| `git rev-parse --show-toplevel` | `/Users/victor/git/grove` |
| `git config --get core.hooksPath` | `/etc/grove/no-hooks` (host hooks cannot run) |
| **a real `git commit` (ADR 0038)** | **`d3bb2e0` landed on the host's `master`**, one file; undone with `git reset --soft HEAD~1`, HEAD back at `6c116b7` |

The `git commit` was the obligation ADR 0038 left and this design previously failed to state. It
is now discharged end to end through grove's own argv.

`npm test`: 832 passed / 76 files. `npm run typecheck`: clean.

## Deviations and decisions taken inside the slice

Each is mechanical, or forced by a constraint the design already set. Nothing here re-opens a
one-way decision.

1. **`GROVE_CLI_BUNDLE` — the one place the design left a gap.** It specifies a baked
   three-line `/usr/local/bin/grove` shim running `exec node <cliBundle> "$@"`, *and* that the
   bundle is mounted rather than baked so a grove upgrade never invalidates the tag. A baked
   shim cannot know a path that differs per install, so the path arrives at run time:
   `sandboxArgv` emits `-e GROVE_CLI_BUNDLE=<cliBundle>` and the shim is
   `GROVE_CLI_BUNDLE=${GROVE_CLI_BUNDLE:?…}` then `exec node "$GROVE_CLI_BUNDLE" "$@"`.
   Measured working with a read-only mounted bundle. Worth a human nod at review.
2. **The CLI bundle is read-only.** The Container spec block shows only `--volume` for it, but
   the Mount mode row lists "grove's own CLI bundle (D7, read-only)", so
   `readOnlyPathsFor` carves it out. Confirmed `EROFS`.
3. **`MountPaths`, not `AgentPaths`, in the signatures.** `sessionEnv` gains its paths as
   *optional* keys, so `src/core/cliEnv.test.ts` keeps compiling and passing untouched. The
   sandbox functions take `Partial<AgentPaths> & { socketPath: string }`; `binDir` stays
   host-only and unmounted, as the design requires.
4. **`specFor` is an addition** to the design's signature list — pure composition of
   `mountsFor`, `readOnlyPathsFor` and `envFor` plus the git common-dir test. It decides no
   policy.
5. **`commonDir` is resolved before it reaches the functions.** `readOnlyPathsFor(kind,
   { commonDir, paths })` takes no `cwd`, so `specFor` passes `null` when the common dir is
   already inside the working directory (a plain checkout) and the path when it is not (a
   worktree, or a session started in a subfolder). Both verified.
6. **`/etc/grove/no-hooks`** is the empty directory for `core.hooksPath`; the design fixes only
   that one is baked into the image.
7. **`imageRef` truncates to 12 hex**, matching Apple's own digest display; the design says only
   "truncated".
8. **Base `node:22-slim`**, pins `@anthropic-ai/claude-code@2.1.296` and `opencode-ai@1.19.0`.
   All three tools the design names are present; the image carries no `curl`, so the egress
   checks were run with `node`.
9. **Two refusals pulled forward** from slices 5 and 6, because the design forbids the
   alternatives: `sandboxed` with `kind: 'terminal'` or `'opencode'` returns `no-sandbox`. A
   terminal has no agent argv to wrap, and a sandboxed OpenCode would register its own service
   and evict the host's (D6). Slice 5 lifts the OpenCode refusal; slice 6 still owns
   `sandboxAvailability`, the `MESSAGES` entry and the app-side message.
10. **`no-sandbox` on anything that stops the sandbox**: a missing or stopped `container`, a
    failed build, a missing Dockerfile. `imageRef` sits inside the `try` — an early version let
    a missing Dockerfile throw out of `sessionCreate` instead of failing, caught by the test
    `refuses no-sandbox when the Dockerfile itself is missing`.
11. **`Session.sandboxed` is required and persisted**, so six renderer test fixtures and
    `projectUi.test.ts` gained `sandboxed: false` / `schemaVersion: 9`. Mechanical fallout of a
    required field, the same as `workflowStatus` was.

## Notes for the next slices

- `sessionResume` is deliberately untouched: slice 1 sandboxes the create path only. A session
  with `sandboxed: true` that is resumed today resumes **unsandboxed** — slice 2's job, and the
  reason that ordering exists.
- `MESSAGES` in `src/main/cliServer.ts` has no `no-sandbox` entry yet, so the CLI prints the bare
  code (`grove: no-sandbox: no-sandbox`) until slice 6.
- The app had to be restarted during the manual verify: the `npm run dev` already running was
  not rebuilding. Worth knowing before a manual run that appears to test stale code.

## Residue

- Removed: the test container, the throwaway `grove-sandbox-probe:0` image, its build context,
  the probe commit and every scratch file. Left: `grove-sandbox:cbcd1e51f27a`, which is the
  feature's image and what grove will reuse.
- Apple's `buildkit` builder container was removed by an over-broad cleanup loop. It is
  recreated on the next `container build`.
- `refs/probe` in this repo is a broken ref containing `x`, dating from 2026-10-10. Predates
  this slice; left alone.

## Corrected finding: the Apple `container` mount fault was a misdiagnosis

An earlier version of this file (v1, 2026-10-10) recorded an environment blocker: that
every `container` run requiring a mount failed with `NSPOSIXErrorDomain Code=19
"Operation not supported by device"` (ENODEV). **That blocker was never real.** It is
retained here only so the correction is not lost.

The actual cause: **`container run -i -t` requires a real controlling TTY on the host.**
Tested from a non-TTY context it fails with ENODEV; under a PTY it succeeds. Nothing to
do with mounts. Every "mount" failure observed on 2026-10-10 was a run that also carried
`-i -t`, and every mount-only run was untested or misread.

**grove is unaffected**, because it never runs `container` from a non-TTY context: the
leaf command runs inside a tmux pane, which always has a real PTY. The lesson for anyone
testing this by hand is that a shell without a TTY on stdin cannot exercise the design's
argv at all, and will report a false failure.

Confirmed again on 2026-10-11: the battery above ran with grove's exact argv minus `-i -t`
(a shell needs no TTY and the container must exit), after the `-i -t` path had already been
proven by the real agent's TUI rendering in its pane.

## Open questions

None.