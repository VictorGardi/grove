---
feature: 2026-10-08-agent-sandboxing
phase: implementation
status: draft
version: 6
created: 2026-10-10
updated: 2026-10-11
based_on:
  - 03-design.md@8
  - 04-structure.md@5
forced: []
---

# Agent session sandboxing — implementation

## Verified end to end by the human, 2026-10-11

The human ran `grove new claude --sandboxed --prompt "print pwd"` against a real credential and
**it works** — the session authenticates. That closes the last item slice 2's manual
verification could not reach from this session's environment.

It also produced the first finding from a real run, and it is the one D8 predicted: with
`CLAUDE_CONFIG_DIR` now reaching the host's `settings.json`, the sandboxed agent inherits the
host's hooks, and the ones that shell out to **macOS** binaries cannot work in a Linux VM.
Reproduced with grove's mounts and a dummy token:

```
⎿  SessionStart:startup hook error
⎿  Failed with non-blocking status code:
   /bin/sh: 1: /Applications/Xirp.app/Contents/Resources/node-runtime/node: not found
```

The host's `settings.json` carries hooks on 19 events from three families. Two are guarded and
harmless — the orca hook prints `{}` when its script is missing, and the Superset hook is behind
`$SUPERSET_HOME_DIR … || true`. The five Xirp hooks (`SessionStart`, `Stop`, `PostToolUse`,
`PermissionRequest`, `Notification`) hardcode `/Applications/Xirp.app/…` with no guard, so they
fail on every event they are bound to.

**This is the accepted consequence, not a regression**: D8's own decision table says a sandboxed
agent "now gets the host's settings, plugins, skills, commands and history, which until now it
silently did not". A hook that drives a host application cannot work in the VM, and Claude Code
classifies the failure as non-blocking, so the session continues. grove should not paper over it:
the hook is visible, the failure is accurate, and a silent success would be worse.

**Worth a later decision, not this slice:** the container runs `uid=0`, so every inherited hook
executes as root inside the VM. Two guarded families make that harmless today. It stops being
harmless the moment an unguarded hook touches something. Apple's `container` can run a
non-root uid (`--user`), and Anthropic's own sandbox guidance refuses to run
`--dangerously-skip-permissions` as root — grove does not pass that flag, which is why the
session starts today. Noted, not decided.

## Finding: `--read-only-path` does not enforce an absent target, and D8's carve-outs are absent by default

**Resolved 2026-10-11: the human chose option B (below). The slice is complete; the carve-outs
stay `--read-only-path` and the limitation is documented here.** Kept in full because the
measurement is what justifies the decision, and because the design text still needs correcting.

D8 says the three authority-carrying files become read-only carve-outs, so "the agent can read
the human's authority but never rewrite it". grove implements that literally — one
`--read-only-path` per file. Measured 2026-10-11 on this Mac, with grove's exact argv:

| Target | On the host | Write from inside the container |
| --- | --- | --- |
| `~/.claude/settings.json` | present | **refused** (EROFS) — the carve-out holds |
| `~/.claude/.credentials.json` | **absent** | **succeeded** — the carve-out does not exist |
| an ordinary file in the same dir | absent | succeeded (expected — the dir is rw) |

`--read-only-path` on a path that does not exist is silently a no-op: the run succeeds, the
flag is accepted, and the write lands on the host. Confirmed by re-creating the file and
re-running: once it exists, the very same argv refuses. So it is presence, not spelling, order
or path form. Rejected as explanations, each measured: `--read-only-path` **before** `--volume`
(writes through), `--mount type=bind,...,readonly` on a file (`Error: path ... is not a
directory`), `--masked-path` (does not mask, and the write still lands), `--volume file:file,ro`
(silently absent). `,readonly` as a volume suffix does not work at all — every such run failed
to mount. The only syntax that works is `:ro`.

**Why this lands exactly where D8 needs it.** `.credentials.json` is absent on precisely the
machines D8 exists for: on macOS Claude Code keeps its login in the Keychain, and
`~/.claude/.credentials.json` is only the **fallback** store (the docs: "when the Keychain
rejects the write, such as when it's locked in an SSH session"), so a normal Mac has no such
file — verified on this machine, where the Keychain item exists and no `.credentials.json`
does. So the carve-out grove emits for the file that motivated D8 is inert on the target
configuration. `auth.json` is in the same position (absent here, no host OpenCode login).
`settings.json` is the lucky one: it exists, so it is enforced.

**Severity, corrected 2026-10-11 against Anthropic's published authentication precedence.**
An earlier version of this paragraph quoted D8's own wording — "a writable one lets a
sandboxed agent rewrite the human's login" — and implied that consequence follows here. It
largely does not, and the reason is the documented precedence order:

1. cloud provider creds → 2. `ANTHROPIC_AUTH_TOKEN` → 3. `ANTHROPIC_API_KEY` → 4. `apiKeyHelper`
→ 5. `CLAUDE_CODE_OAUTH_TOKEN` → 6. profile / federation creds → **7. subscription OAuth
credentials from `/login`** — and that last rank is what the Keychain and `.credentials.json`
hold.

Both variables grove forwards (`CLAUDE_CODE_OAUTH_TOKEN` at 5, `ANTHROPIC_API_KEY` at 3)
outrank the file. So in any session grove actually opens with a forwarded token, a planted
`.credentials.json` is simply not the credential that gets used. The exposure is confined to
the one case grove permits with no env token — the `.credentials.json` channel alone — where
nothing stops the agent dropping a file a later tokenless session could pick up. Real, and
grove does not close it, but far narrower than "rewrite your login".

What survives the correction, and is the part that matters: **the carve-out grove emits does
not do what the design says it does**, silently, on the configuration D8 was written for.

This is D8's stated consequence failing, so grove-implement stops rather than pick a mechanism.
Nothing in `03-design.md` or `04-structure.md` was edited, and no workaround was written.

### The two ways out, both measured

**A. Read-only parent, writable nested re-binds.** `--volume <claudeHome>:<claudeHome>:ro`,
plus a `--volume` per subdirectory the agent legitimately writes (`projects`,
`shell-snapshots`, `history.jsonl`, `todos`, `cache`, …). Measured: the carve-out is refused
(EROFS), `settings.json` stays readable, and the nested subdirectories stay writable. It holds
for **absent** targets, because the whole directory is read-only. Cost: the list of writable
subdirectories is Claude Code's own layout, so it must be maintained against a third party's
directory structure, and it fails **closed and loud** — a subdirectory grove has not heard of
gets EROFS. It also buys a broader guarantee than D8 asked for (nothing in `~/.claude` is
writable but the allow-list: `plugins/`, `commands/`, `settings.local.json`, and so on), which
is why it is a feature of its own rather than a detail of D8.

**B. Keep `--read-only-path` and accept the hole.** **Chosen by the human, 2026-10-11.**

### Why B, given the reachability analysis

Cross-referencing grove's own refusal with Anthropic's published precedence, every reachable
case is already closed:

| Env token set? | `.credentials.json` on host | grove | File writable inside? | Consequential? |
| --- | --- | --- | --- | --- |
| yes | absent | starts | yes | No — the env token outranks the file, so a planted one is not used |
| yes | present | starts | no (EROFS) | No |
| no | present | starts | no (EROFS) | No |
| no | absent | **`no-sandbox`**, nothing starts | — | No session exists |

There is no row where the gap bites. grove refuses before it can, and where it proceeds the
forwarded token outranks anything the agent could plant. B is therefore not "accept a security
hole" — it is "document a limitation grove's existing logic already makes unreachable", and it
costs one line of code that is already written.

A third path exists and is rejected here for the same reason D8 rejected reading the Keychain:
**grove pre-creates** an empty `.credentials.json` / `auth.json` on the host so the carve-out
binds. That is grove writing into the human's credential store, which D8's "grove writes a
credential file" rejection already covers.

**Still owed, and deliberately not done here:** `03-design.md`'s D8 and `04-structure.md`'s
slice-2 outcome both state the carve-outs unconditionally. They are conditional on the file
existing. Correcting approved design text is `grove-design`'s to do, not this skill's.

## What slice 2 did land

The D8 channel works. Measured, under a real controlling TTY (`script -q /dev/null`), with
grove's exact composed argv and a **dummy** token — the Keychain secret never entered a
container:

- **`CLAUDE_CONFIG_DIR` reaches the host config.** The container prints
  `CLAUDE_CONFIG_DIR=/Users/victor/.claude` and reads the host's `settings.json` contents
  inside. This is the fix for the "Select login method" dead end: the config volumes were
  mounted and unread because `~` is `/root` in the VM; the pointer makes them live.
- **The token is forwarded bare.** `-e CLAUDE_CODE_OAUTH_TOKEN` with no `=value` arrives with
  the value set inside, and `ANTHROPIC_API_KEY` unset stays unset. The value never enters argv
  or ps.
- **The login gate is cleared in the real TUI** — Claude Code renders its TUI past
  "Select login method" and answers `--prompt "print pwd"`. With the dummy token the request
  fails at the API with a 401 on the token itself, which is the proof that the *channel* works:
  the failure moved from "Not logged in" to "your token is wrong".
- **OpenCode's pointer works too**, same run shape: `opencode auth list` inside the container
  resolves to the **host** path `/Users/victor/.local/share/opencode/auth.json`, not `/root/…`.
- **An absent `-e VAR` does not fail the run** (re-measured, exit 0) — which is why the
  refusal probes the login shell instead of attempting a run.
- **Writing to `settings.json` from inside gives EROFS** — the carve-out that *is* present is
  enforced. `.credentials.json` is absent here and therefore not; see the finding above.
- The refusal itself is covered by tests only: this Mac has no credential in any login shell,
  so `grove new claude --sandboxed` cannot reach the point of showing a real pane. The
  `no-sandbox` message naming `claude setup-token` is asserted in `cliServer.test.ts`.

Not run: the *populated* OpenCode case (`opencode auth list` listing a real provider) — this
machine has no host OpenCode login, so there is nothing to list. Slice 6 owns that check.

`npm test`: 853 passed / 77 files (was 832). `npm run typecheck`: clean.

## Deviations and decisions taken inside the slice

1. **The card step was skipped, not done narrowly.** The plan named
   `src/renderer/src/components/SessionCard.tsx`; no such file exists, and no component renders
   a sandbox tag — slice 4 owns the tag. Independently, the credential label lives on the
   transient `SandboxSpec`, which the renderer never sees, and the plan forbids persisting it
   on `Session`. So there was nothing to attach the label to and no route to deliver it. Left
   for slice 4, where the tag it names will exist.
2. **`credential` on `SandboxSpec` is currently write-only.** It is populated from the probe
   and tested, but no consumer reads it yet — the card step that would is the one above. Kept
   because slice 4 needs it and it costs one field; it is not dead code so much as code
   awaiting its reader. Worth a human's eye at review.
3. **`envFor` gained `kind` as its first parameter**, per the design's own signature list
   (`envFor(kind, session, o: { paths })`), which is a breaking change to slice 1's function.
   Callers: `specFor` only.
4. **`readOnlyPathsFor` places the carve-outs before `gitconfig`**, keeping git concerns
   adjacent; ordering is cosmetic and asserted only within this slice.
5. **`loginShellCredential` spawns the shell twice when no variable is set** (once per
   candidate), then checks the file. Sequential, ~2× the latency of one spawn, in exchange for
   stopping at the first hit. Measured cost is negligible against the container start.
6. **`process.env.SHELL || '/bin/zsh'` in `core.ts`** rather than passing the shell through
   `opts`, matching `loginShellArgv`'s own fallback in `src/core/env.ts:43`.

## Deviations carried from slice 1

7. **The two refusals slice 1 pulled forward stand** (opencode, terminal): untouched.
   ADR 0039 / D7 and `gitCommonDir` untouched, as instructed.

## Residue

- Nothing left on the host: every probe file written into `~/.claude` during this slice
  (`.credentials.json`, `.absent-probe.json`, `.plain-probe.txt`) was removed, and
  `settings.json` is byte-identical (`grep -c tampered` → 0). The probe script
  (`resources/sandbox/probe-inside.sh`) and the argv-dumping test were deleted; they were
  scaffolding, not deliverables.
- No containers left running; `container list` is empty. The image `grove-sandbox:cbcd1e51f27a`
  remains, as in slice 1.

## Open questions

None. The one that was open here — A or B for the absent-target carve-out — is answered in the
finding above (B, by the human). One item is owed but is not a question for this phase:
`03-design.md`'s D8 and `04-structure.md`'s slice-2 outcome state the carve-outs
unconditionally, and correcting approved design text belongs to `grove-design` in revise mode.

## Carried to the next slice

- **The human's own macOS hooks now load inside the sandbox and the unguarded ones fail.** See
  the verified-end-to-end section above. Expected, non-blocking, and documented — but if the
  host's `settings.json` ever gains an unguarded hook that touches the filesystem, it will run
  as `uid=0` in the VM. Running the container as a non-root uid is the eventual fix and belongs
  to a slice of its own.
- **OpenCode runs v2.0.20 on this host; the sandbox image pins `opencode-ai@1.19.0`.** Measured
  2026-10-11. The version skew is slice 6's problem and it is not small: D6's whole plan is a
  sandboxed TUI joining the host's shared service, and the two versions may not agree on the
  wire protocol or on where credentials live. Worth resolving before slice 6 is planned, not
  during it.
- **The credential label has no reader yet.** `SandboxSpec.credential` is populated and tested;
  nothing renders it until slice 4 builds the sandbox tag.

---

# Slice 1 (58c4e1f), kept for the record

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

*(Superseded by slice 2 where marked.)*

- `sessionResume` is deliberately untouched: slice 1 sandboxes the create path only. A session
  with `sandboxed: true` that is resumed today resumes **unsandboxed**. Still true after slice 2;
  slice 3 owns it.
- ~~`MESSAGES` in `src/main/cliServer.ts` has no `no-sandbox` entry yet, so the CLI prints the bare
  code (`grove: no-sandbox: no-sandbox`) until slice 6.~~ **Done in slice 2**: `no-sandbox` now maps
  to a message naming `claude setup-token`.
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