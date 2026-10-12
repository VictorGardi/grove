---
feature: 2026-10-08-agent-sandboxing
phase: implementation
status: stale
version: 13
created: 2026-10-10
updated: 2026-10-11
based_on:
  - 03-design.md@9
  - 04-structure.md@6
forced: []
---

# Agent session sandboxing — implementation
---

# Slice 6 — OpenCode in the sandbox, joining the host's service (D6)

## Slice 6, correction — grove tells the sandboxed OpenCode where the host service is

The fix for the `EADDRNOTAVAIL` above, taken straight after it: `03-design.md` v10 and
`04-structure.md` v7 (approved 2026-10-12), then implemented.

### What changed in the artifacts

**`03-design.md` v10** — D6 gained the rule the first implementation missed, stated three times over
so it cannot be read as description again: **the container's URL is grove's to compose, never its own
to find.** The spec block now shows `opencode --server http://<bridge>:<port>` on the agent argv;
§ Lifecycle carries the measured failure; `ensureServiceReachable` returns the gateway and
`serviceEndpoint` composes the URL; `AgentPaths` documents the two `service.json` fields; the
two-way table records the human's two decisions and the **undecided** consent prompt; and a new risk
covers the one nobody had written down — **the bind moves grove's own client onto the bridge too**,
because grove's `HttpOpenCode` connects to whatever `url` the registration names, so `bridge100`
disappearing takes OpenCode status down for the host's own sessions.

**`04-structure.md` v7** — slice 6's outcome says grove composes the `--server` URL and that no
registration is `no-sandbox`; its signatures and verification follow; and the refusal now also
belongs in slice 7's list, which is where refusals live.

**Approved by the human's explicit instruction** ("rewrite, approve, then fix right away"), after
running the content gates by hand: no `TODO`/`TBD` in either file, `## Open questions` empty in
substance, all eight one-way decisions present with their chosen options, all seven slices carrying a
verification step. `approved_at: 2026-10-12` on both.

### What landed

- **`src/core/sandbox/service.ts`**: `ensureServiceReachable` now resolves to the **gateway** —
  the one it discovered, or the one already in the config on the idempotent path — because the
  caller needs it to compose a URL. `servicePassword` is replaced by
  `serviceEndpoint({ registrationFile, gateway })`, which reads the registration once, keeps its
  **port**, swaps the host for the bridge, and returns `null` rather than guessing.
- **`src/core/sandbox/launch.ts`**: `reachHostService` returns that endpoint; the agent argv becomes
  `[argv[0], '--server', url, …]` for opencode only; and an opencode session with no endpoint is
  `null` at the seam, so a create is refused `no-sandbox` and a resume downgrades with its note.
- **Tests**: 3 cases in `service.test.ts` (endpoint composition and all five null cases, plus the
  two gateway returns), 4 in `sessionCreate.test.ts` (the `--server` argv, the password, the refusal,
  and that a sandboxed Claude is untouched).

`npm test`: **938 passed / 83 files**. `npm run typecheck`: clean. `npm run build`: clean.

### Deviations

30. **`servicePassword` became `serviceEndpoint`** rather than gaining a sibling. It reads the same
    file for the same reason, and the URL and the password have to agree about which registration
    they came from; one function returning both cannot return half of one and all of the other.
31. **The refusal is in `launch.ts`, not `core.ts`.** It has to be, for the reason recorded for the
    whole slice: the seam's try is what turns every sandbox failure into `no-sandbox` or a
    downgraded resume. It lands before the bind is written, as the human's decision specifies.

## Still not run — and it needs two humans, not one

The manual pass additionally needs the **host OpenCode service restarted**, so that the bind grove
wrote at 04:46 actually takes effect. Until that happens a sandboxed OpenCode gets
**connection-refused** to `192.168.64.1:49374` rather than `EADDRNOTAVAIL` — a different failure, and
the one this fix is meant to clear, but it will not clear itself.

The service is `opencode serve --service`, pid 1133, **ppid 1** — detached, so nothing restarts it
automatically. Sessions are safe: `~/.local/share/opencode/opencode.db` is 175 MB on disk and the
service is a stateless server over it. A `kill` costs a reconnect flicker, not history.

The `.html` companions for `03-design` and `04-structure` are **stale** — they were rendered at v9/v6.
`grove.config.json` has `commitHtml: false`, so they are untracked working files, not part of the
commit. Re-render with `grove-render 2026-10-08-agent-sandboxing` when convenient.

## Open items still standing

- **The host restart**, above. Blocking the manual pass.
- **The consent prompt** — recorded as undecided in the two-way table, deliberately built for
  nothing.
- **The cross-version check** the spikes could not settle: `@opencode/cli@2.0.26` against the host's
  `2.0.20` over `--server`.
- **Slice 5's manual pass**, still unticked.

---
## Finding, 2026-10-12: a sandboxed OpenCode tries to **bind** the address grove wrote for the **host**

The human ran a sandboxed OpenCode session against this build. It came up "Session ended", and
resuming printed:

```
Starting background server...
Error: Server process exited with code 1
ServeError: … [cause]: Error: EADDRNOTAVAIL: address not available, listen
    at service.ensure … at cli.server-connection.resolve
```

**This is slice 6's, and it is not the `Errno 49` the spikes recorded — it is the same signature
with a different cause, and slice 6 causes it.** Measured on this machine while it was happening:

```
~/.config/opencode/service.json   {"password": …, "hostname": "192.168.64.1"}   ← grove wrote it
~/.local/state/opencode/service.json  {"url": "http://127.0.0.1:49374", "pid": 1133, …}  ← untouched
```

What the container did, in order:

1. `XDG_STATE_HOME` points at the host's state dir, so the client read the registration and tried
   `http://127.0.0.1:49374`. Inside the VM, `127.0.0.1` is the container itself — unreachable.
2. Failing that, the client fell back to `service.ensure` and **started a background server of its
   own**. `Starting background server...` in the transcript is that fallback, not a grove message.
3. That server read the **config**, which grove mounts read-write into the container under
   `XDG_CONFIG_HOME` — and grove had just written `hostname: 192.168.64.1` into it.
4. `192.168.64.1` is the **host** side of the bridge. The container's own address is
   `192.168.64.140`. Binding to an address no local interface holds is `EADDRNOTAVAIL`.

So grove handed the container an address it may only ever **connect to**, through a file whose
whole meaning is **bind here**. The write itself is correct and proved itself: the service's own
`password` survived the read-modify-write, exactly as `service.test.ts` asserts.

**What held.** D6's backstop did its job: the container could not register over the host's service,
because `~/.local/state/opencode` is mounted read-only. The host's service (pid 1133) is still the
incumbent, and the host's registration is byte-unchanged. Nothing was evicted.

**The fix is already in the approved artifacts, and this slice under-read it.**
`04-structure.md`'s slice-6 verification says: *"the image's `@opencode/cli` client against the
host's v2 service **over `--server`**"*, and `03-design.md` D6 says *"the client seam is the global
`--server <url>` flag"*. Slice 6 read those as description of the seam and assumed instead that the
container would take its URL from the registration file it can read. That assumption is what failed:
the registration says `127.0.0.1`, which is correct on the host and meaningless in the VM.

With `--server` the client is told where to go and never calls `service.ensure`, so it never binds
anything and the `hostname` in the config is never consulted. The URL is grove's to compose: the
**discovered gateway** plus the **port from the registration**. `OPENCODE_SERVER_PASSWORD` is
unchanged and still needed.

**This changes D6, so it is `grove-design`'s to approve and not this slice's to implement.** It is
recorded here, and the fix is proposed, not built.

### The human's decision, 2026-10-12

**A sandboxed OpenCode with no host service registration is refused `no-sandbox`.** This settles the
open item this slice logged: no registration means no port, so grove cannot name a server to point
`--server` at — and there is nothing to join either, since the read-only state dir stops the
container starting one. Refusing is consistent with the rest of the feature (ADR 0036, ADR 0033):
never a pane that cannot work, never a silent fallback.

Note the shape this gives the no-registration case: it is no longer reachable through a container
that half-starts, and it is decided **before** the bind is written.

## The consent prompt still says no surface — and no decision has been taken

The human was asked whether the prompt is asked in the CLI, the GUI, or both, and explicitly
**deferred** ("no decisions now"). Nothing about it has changed and nothing was built for it.
Recorded here so the question is not lost and so no later session reads its absence as an oversight:

- `03-design.md:420` names the prompt — "Grove writes the bridge address, **with a consent prompt**
  the first time" — and names no surface. `04-structure.md` v6 omits it entirely. Later artifacts
  take precedence (`contract.md` rule 1), which is why slice 6 wrote the bind without one.
- grove has two front-ends into the same `sessionCreate`: the renderer via `main/ipc.ts`, and
  `src/cli/index.ts` via `cliServer`. So it is one core-side decision and up to two of them.
- It is not a one-liner: `sessionCreate` returns `Result<T>` synchronously, so a prompt cannot
  block inside it. It needs a result the caller resolves and a retry carrying the answer, plus a
  non-interactive path for the CLI.
- **Open, undecided.** For whoever picks it up.

---## What landed

- **`src/core/sandbox/service.ts`** (NEW): `ensureServiceReachable({ configFile, container, … })` and
  `servicePassword(registrationFile)`.
- **`src/core/sandbox/spec.ts`**: `AgentPaths` gains `opencodeRegistration`; `envFor` and `specFor`
  take `serverPassword?`; an OpenCode session's env gains `XDG_STATE_HOME` and
  `OPENCODE_SERVER_PASSWORD`.
- **`src/core/sandbox/launch.ts`**: a sandboxed OpenCode reaches the host service and collects its
  password before `specFor`, inside the try that already owns every sandbox failure.
- **`src/main/index.ts`**: the two `service.json` files each get the field that names them.
- **`src/core/core.ts`**: the `sessionCreate` refusal widens from Claude alone to both agents; a
  terminal is still refused.
- **`src/renderer/src/sandboxOptIn.ts`**: `sandboxable` now covers OpenCode. No other renderer file
  changed — the dialog reads `sandboxable`/`wantsSandbox` for its disabled state, its `aria-checked`,
  its class and its summary line, so all four follow.
- **`resources/sandbox/Dockerfile`**: `opencode-ai@1.19.0` → `@opencode/cli@2.0.26`.
- **Tests**: `src/core/sandbox/service.test.ts` (NEW, 14 cases), 3 cases added to
  `src/core/sandbox/spec.test.ts`, 2 added to `src/core/sessionCreate.test.ts` (and the
  opencode-refusal assertion there replaced), 1 rewritten in `src/renderer/src/sandboxOptIn.test.ts`.

`npm test`: **935 passed / 83 files** (was 911 / 81). `npm run typecheck`: clean. `npm run build`:
clean — the renderer client build that slice 5 could not run now builds, because the other agent's
`NewSessionDialog.tsx` landed.

## The three things this slice had to work out, and how

**1. How the container finds the service, at all.** D6's outcome is that the container *joins* the
host's service. Nothing in design v9's spec block says how. The answer is in the spikes: the host
service writes the address it is reachable on into its **own registration**, so bound to `0.0.0.0`
it registered `url=http://0.0.0.0:49558` and bound to the bridge it registers
`url=http://192.168.64.1:49561`. The container already has that file — it is inside
`~/.local/state/opencode`, which is mounted read-only. But only if `XDG_STATE_HOME` points at the
host's state dir, and design v9's spec block pointed only `XDG_DATA_HOME` and `XDG_CONFIG_HOME`.
Without the third pointer the client looks in `/root/.local/state`, finds no registration, and
starts a service of its own — which **evicts the host's** and is the exact failure D6 exists to
prevent. So the container needs no `--server` flag (the spikes confirmed `--server` is the seam for
a v2 client, and this is that seam, but the registration supplies the URL), and `XDG_STATE_HOME` is
what makes it work.

**2. The password is the half the client does not read for itself.** The address comes from the
registration; the credential does not, and the service answers 401 without `OPENCODE_SERVER_PASSWORD`.
So grove reads the registration — and never writes it. A second registration evicts the incumbent,
which is why the write is confined to the *config*, read-modify-write so the service's own `password`
and `port` survive.

**3. `opencodeServiceConfig` was the wrong path under its own name.** `src/main/index.ts` filled it
with `serviceFilePath(...)` — the registration — and passed that to `HttpOpenCode` as its
`serviceFile`. Slice 6 needs the config for the bind *and* the registration for the password, so the
field is now `opencodeRegistration` and `opencodeServiceConfig` means what the design's
`AgentPaths` list says it means. `HttpOpenCode` is handed `serviceFilePath(...)` directly, so what
it watches has not changed by a byte.

## Measured this session, read-only

`container network ls --format json` on this machine returns one element:
`[{"configuration":{…,"name":"default",…},"status":{"ipv4Gateway":"192.168.64.1","ipv4Subnet":"192.168.64.0/24",…}}]`
— which is the shape `service.ts` parses and the fixture `service.test.ts` is built from. No
container was started, stopped or removed, and `container system start` was **not** run: it can
install a kernel and there is a live grove sandbox session on this machine.

## Deviations and decisions taken inside the slice

23. **`XDG_STATE_HOME` is new, and design v9's spec block does not list it.** It is not a new
    decision; it is the mechanism D6's own outcome requires, and the third instance of the one
    pointer D8 established (`CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`) at a path
    grove already mounts. Design v9's block should gain the line; `grove-design`'s to correct.
24. **`AgentPaths` gained `opencodeRegistration`.** Design v9's list names `opencodeServiceConfig`
    and nothing else; slice 6 needs two different files and the spikes measured exactly why they are
    easy to confuse. The pre-existing field now holds the config it is named for.
25. **`ensureServiceReachable` is called from `launch.ts`, not `core.ts`.** The structure lists core.ts
    for "bind on the first sandboxed OpenCode", but `launch.ts` is the only place that holds both
    `sandbox.container` and `sessionEnv`, and it owns the try that turns every sandbox failure into
    `null` — so a bridge that never appears is `no-sandbox` on create and a downgraded resume with
    its note, never an OpenCode that quietly starts a service of its own (ADR 0033, ADR 0036).
    core.ts's slice-6 change is the refusal, which is what the structure also asks for.
26. **`ensureServiceReachable` takes optional `attempts`/`firstDelayMs`/`maxDelayMs`.** The design's
    call shape `{ configFile, container }` is unchanged and is what production uses; the three knobs
    exist so the poll can be tested without spending the real budget. Defaults: 30 attempts,
    250 ms doubling to 8 s — about 3½ minutes, which clears the measured 2m24s from login to
    `bridge100`.
27. **`servicePassword` is a second export of `service.ts`.** The design names only
    `ensureServiceReachable`, but the password has to be read from somewhere and the registration
    file is the service's; putting it beside the bind keeps the two `service.json` files in one file.
28. **`sandboxOptIn.ts` is in this slice though the structure's file list omits it.** Slice 4's own
    comment says it moves "here once, not in two files" when OpenCode becomes eligible, and the
    design's entry-point row says the dialog is an entry point. Leaving it out would have shipped a
    capability reachable only from the CLI, with the dialog greying out a toggle that now works.
29. **`writeConfig` creates the config's parent directory.** opencode normally made it; grove does
    not assume. The file is created mode `0600` — the human's umask is not a security property, and
    the file holds a password.

## Open items this slice did not resolve, and deliberately did not work around

- **The service reads its config when it starts.** grove writing the bind changes where the service
  *will* listen; it does not rebind a service that is already running. So on the first sandboxed
  OpenCode session after the write, the host service may still be on loopback with a
  `127.0.0.1` registration, and the container will not reach it until that service next starts.
  Restarting the human's OpenCode service is not a decision design v9 or structure v6 makes, so
  nothing here does it. **This is the most likely thing the manual pass will trip over**, and it is
  a `grove-design` question: does the bind need a restart, a prompt to restart, or a documented
  "takes effect next time your service starts"?
- **The consent prompt.** `03-design.md`'s two-way table says grove writes the bridge address "with
  a consent prompt the first time". `04-structure.md` v6 — later, and `based_on: 03-design.md@9` —
  lists slice 6's files, outcome and verification with no prompt and no renderer file. Later
  artifacts take precedence (`contract.md` rule 1), and a prompt would need a decision the design
  does not make — how consent is carried through `sessionCreate` — so this slice neither built one
  nor silently dropped the clause. **Owed to `grove-design`**: fold a consent prompt into a
  structure entry that owns it, or drop the clause.
- **No registration file means no password.** A machine with no host OpenCode service running gets a
  sandboxed OpenCode with no `OPENCODE_SERVER_PASSWORD`, which cannot authenticate. Refusing
  `no-sandbox` there would be a new decision, so it was not taken.
  - **What this is about, and what it is not** (clarified 2026-10-12, after the human asked):
    this is **service** authentication — whether the container may speak to the host's HTTP service
    at all. It has nothing to do with **which models the agent may use**, which is D8's separate
    channel and which works either way:
    - *Zen free tier* needs no credential at all — the tier is gated on the client being opencode
      (measured: two models completed in the real container with `0 credentials`).
    - *A host `opencode auth login`, including GitHub Copilot*, reaches the sandbox through
      `XDG_DATA_HOME` → the `auth.json` grove already mounts (measured: `● GitHub Copilot  api — 1
      credentials` read from the mount, `Read-only file system` on write).
    So a human who is on free models today and moves to Copilot later is unaffected by this item in
    both states. It bites on exactly one machine shape: **no host OpenCode service registered right
    now**, where there is no password *and* nothing to join — the read-only state dir stops the
    container starting a service of its own. The open question is what grove should do there.
  - **One honest gap in the reasoning.** grove passes `OPENCODE_SERVER_PASSWORD` because the
    measured 401→200 pair was a raw `curl` with and without an `Authorization` header. Nobody has
    run an actual opencode **client** against the host service *without* that variable to see
    whether it self-authenticates from the registration it can already read. If it does, grove's
    env entry is belt-and-braces rather than load-bearing; either way supplying it is correct, and
    the manual pass settles which.
- **The consent prompt says no surface.** `03-design.md:420` names the prompt but not whether it is
  asked in the CLI, the GUI, or both, and the structure omits it entirely. grove has two front-ends
  into the same `sessionCreate` — the renderer's `main/ipc.ts` and `src/cli/index.ts` via
  `cliServer` — so it is one core-side decision and up to two of them. It is not a one-liner:
  `sessionCreate` returns `Result<T>` synchronously, so consent cannot block inside it and needs a
  result the caller resolves (`no-sandbox`'s sibling, say) plus a retry carrying the answer; a
  non-interactive CLI invocation would then need a `--yes`-style flag or an error telling the human
  to run it from the app. **Owed to `grove-design`**, and it is the shape, not just the presence, that
  needs deciding.
- **The cross-version check the spikes could not settle**: `@opencode/cli@2.0.26` in the image
  against this host's `2.0.20` service over `--server`, and `opencode auth list` inside a sandboxed
  pane listing the host's provider. The bundled source says minor skew warns and proceeds on that
  path; nothing here has watched it happen.
- **Slice 5's manual pass** (`container list` after ⌘W, the `grove-orphan` prune at restart) is still
  unticked for the same reason. Its `typecheck` and `build` boxes are now ticked: the foreign file
  that blocked them landed.

## Residue

- Nothing left running or on disk. No container was started, stopped or removed; the live sandbox
  container `grove-941adcfb-f145-4256-8b3e-fb6d61bc2009` is as it was found; `container system start`
  was not run; the host's `~/.config/opencode/service.json` was **not** written — every test wrote to
  a temp path.
- `reports/` and `research_notes/` remain untracked and ignored; nothing from either is staged.

## Open questions

None. The three items above are owed to the human and to `grove-design`; none of them is a question
this phase can answer by writing code.

---
# Slice 5 — Teardown, and pruning what a crash left behind

## Staleness: expected, and the version jump is logged here

`05-plan.md` was written against `03-design.md@8` / `04-structure.md@5`. The `grove-design` revise of
2026-10-11 moved both to **v9 / v6** (D6 and D8 corrected against the four spikes, slice 4's opt-in
surface) and marked the plan stale by version. Slices 1–4 are done and untouched — their sections,
their verification and their commits stand. **Slice 5's section was written fresh against v9 / v6,
and `05-plan.md`'s `based_on` now reads `03-design.md@9` / `04-structure.md@6`.** Nothing slice 5
does depends on what the revise changed: slice 5 is teardown and pruning, and neither the D6 nor the
D8 correction touches it. This file's `based_on` moved to match, for the same reason.

## What landed

- **`src/core/sandbox/container.ts`** (NEW): `removeContainer(container, name)` runs
  `container rm -f <name>`; `pruneContainers(container, live)` runs `container list --all --quiet`
  and removes every name matching `/^grove-/` that is not in `live`.
- **`src/core/core.ts`**: a `dropContainer(session)` helper beside `sandboxDeps()`; awaited after
  `backend.kill` in both `sessionKill` and `sessionRemove`; `start()` captures
  `const live = await backend.list()` once, passes it to `reconcile`, and prunes with it.
- **Tests**: `src/core/sandbox/container.test.ts` (NEW, 7 cases) and 4 cases added to
  `src/core/sessionCreate.test.ts`'s `sessionCreate --sandboxed` block.

`npm test`: **911 passed / 81 files** (was 900 / 80; +11). `typecheck:node`: clean.

## Measured, to write this slice at all

`container` 1.5.0 on this machine, **read-only commands only** — no container was started, stopped
or removed, and the live grove sandbox session was left exactly as found:

- `container list --help`: plain `list` prints **running** containers only, `--all` includes the
  rest, `-q` prints one id per line. A container started with `--name X` has **X as its id**, which
  is why `list -q` yields exactly the `session.tmuxName`s that `--name` was given. `--all` is
  load-bearing rather than belt-and-braces: the orphan a SIGKILL leaves is a **stopped** container,
  and plain `list` does not print stopped containers at all.
- `container rm --help`: the subcommand is `delete`, aliased `rm`, and takes `-f`.
- `container --help`: subcommands are `run/create/exec/start/stop/rm`, `image`, `machine`,
  `network`, `volume`, `builder` — Docker's `images`/`runtime` do not exist here.

## Deviations and decisions taken inside the slice

18. **`removeContainer` resolves on *any* failure, not only "no such container."** The design says
    `sessionKill`/`sessionRemove` run `container rm -f <tmuxName>` "ignoring 'no such container'",
    and that is what it does; the broader swallow is because neither command has an error channel
    for this call, and a teardown failure must not fail the ⌘W that came with it. The alternative —
    resolve only on "no such", rethrow otherwise — turns a missing `container` binary into a failed
    kill. `start` prunes whatever is left on the next launch either way.
19. **`dropContainer` is gated on `session.sandboxed && opts.sandbox`.** The design's sentence reads
    "sessionKill/sessionRemove *also* run `container rm -f <tmuxName>`", in the lifecycle of the
    sandbox. Ungated, every ⌘W of every terminal session would spawn a `container` process. A
    session that was never sandboxed has no container; a machine that cannot sandbox has no binary
    to ask. Both directions are asserted.
20. **Prune sits inside the existing `try` around `backend.ensureConfig()`.** `live` comes from
    tmux, so without tmux grove cannot tell an orphan from a running session and the honest move is
    to prune nothing. `pruneContainers` cannot reject, so a prune failure is never mislabelled
    `tmux: …` in the error strip.
21. **`container list --all --quiet` rather than `--format json`.** One name per line is exactly the
    shape grove needs and needs no parser; the JSON form answers a different question (slice 6's
    `network ls`).
22. **The fake `container` is passed by path, not discovered on `PATH`.** The structure's verify
    says "a fake `container` script on PATH"; `sandbox/image.test.ts` and `sandbox/auth.test.ts`
    both take a file path, and `opts.sandbox.container` is already a path grove is handed. Same
    shape, one less global state.

## Not run — the manual pass, and two partly-blocked commands

`container list` after ⌘W, and the `grove-orphan` prune at restart, both need a live app on this
build. The grove instance on this machine is a **stale build** whose sessions carry no `sandboxed`
field, with live sessions attached; restarting it is the human's call and was not done. Those
checkboxes are left unticked in `05-plan.md`.

`npm run typecheck` and `npm run build` are **left unticked for a reason of ownership, not of
doubt.** `typecheck:node` and the main/preload bundles — every file this slice touches lives in the
main bundle — are clean. The only failures are syntax errors in
`src/renderer/src/components/NewSessionDialog.tsx`, which another agent is editing uncommitted at
the moment of writing. Verified not this slice's: a detached worktree at HEAD `25e228d` typechecks
`tsconfig.web.json` clean. Both commands should be re-run once that file lands.

## Residue

- Nothing left running or on disk from this slice. The live sandbox container
  `grove-941adcfb-f145-4256-8b3e-fb6d61bc2009` is exactly as it was found, and no container was
  started, stopped or removed.
- `reports/` and `research_notes/` remain untracked and ignored; nothing from either is staged.
- Another agent's uncommitted work in `NewSessionDialog.tsx` is left intact and unstaged.

## Open questions

None. Slice 5 changes nothing the D6/D8 revise describes, and nothing in that revise changes slice 5.

---
# Slice 4 — Opting in from the launch dialog, and seeing it on the card

## Staleness noted mid-slice (2026-10-11)

A `grove-design` revise ran in parallel (session `cbd3230b`, label
`grove-design-agent-sandboxing-d6-d8`) while this slice was in flight and bumps `03-design.md` /
`04-structure.md` versions, which marks `05-plan.md` stale by version. **This slice was not
re-planned from scratch**; its section was executed as written, per the orchestrating session's
instruction. The plan's `based_on` still reads `03-design.md@8` / `04-structure.md@5` — what this
slice was planned and executed against.

The revise covers D6 and slice 4's opt-in surface, and **confirms the direction taken here**: the
human chose the launch dialog over the ⌘K palette command, so `NewSessionDialog.tsx` is the
direction, not a deviation to undo. The one thing this slice changed that the revise must not lose
is the **default-off** rule below, which three artifacts state and the dialog contradicted.

## What this slice found

The opt-in plumbing was already complete and correct before this slice: `InvokeMap['session:create']`
carries `sandboxed?: boolean` (`src/shared/ipc.ts:18`), `main/ipc.ts` forwards the whole argument to
`core.commands.sessionCreate`, and `App.tsx` sent the flag. `SandboxMark` already named the
filesystem on the card and header. **Two defects were what remained, both in the dialog.**

### 1. The toggle defaulted to on — a direct contradiction of the design

`NewSessionDialog.tsx:47` was `useState(true)`. Every Claude session launched from ⌘⇧T was
therefore sandboxed whether or not the human asked. Against:

- `03-design.md:27` — "Opt-in is per session … **Default off**."
- `01-questions.md:18` — "not a default for every session"; `:76` — "explicit per-session decision".
- ADR 0033 — "Opt-in: `sessionCreate` takes `sandboxed?: boolean`. Absent means `false`", and it
  lists "making sandboxing the default" among its **rejected** options.

This is the most consequential default a containment feature can get wrong: it changes a session's
blast radius without the human asking for it, on the one surface where they were configuring
something else. Fixed to `SANDBOX_DEFAULT` (false).

The core already defaulted off — the new test asserts that where the default takes effect, not
only where it was written down.

### 2. The "only Claude is sandboxable" rule was written twice

`NewSessionDialog.tsx` had a local `sandboxable`, and `App.tsx` had the same rule inline as
`l.kind === 'claude' && l.sandboxed`. They answer different questions — what the form *offers*
versus what it *sends* — and nothing kept them equal. When OpenCode becomes eligible in slice 6 it
would have moved in one file and not the other: the dialog would offer a toggle whose session came
back refused `no-sandbox`, or vice versa.

Both now come from one module, and the switch's `aria-checked`, its `switchOn` class and the
summary line all call the same `wantsSandbox`, so the wording cannot disagree with the toggle.

## What landed

- **`src/renderer/src/sandboxOptIn.ts`** (NEW): `sandboxable(kind)`, `wantsSandbox(kind, sandboxed)`,
  `SANDBOX_DEFAULT`. Each carries the reason it holds — ADR 0034 / D6 for Claude-only, the design's
  "Default off" and ADR 0033's rejected option for the default.
- **`src/renderer/src/components/NewSessionDialog.tsx`**: local `sandboxable` deleted in favour of
  the import; `useState(true)` → `useState(SANDBOX_DEFAULT)`; the switch's `aria-checked`, its
  `switchOn` class and the summary line all use `wantsSandbox(kind, sandboxed)`.
- **`src/renderer/src/App.tsx`**: `sandboxed: wantsSandbox(l.kind, l.sandboxed)`.
- **Tests**: `src/renderer/src/sandboxOptIn.test.ts` (NEW, 7 cases) and one case added to
  `src/core/sessionCreate.test.ts`.

`npm test`: **887 passed / 79 files** (was 876 / 78; +11). `npm run typecheck`: clean.
`npm run build`: clean.

**Not run — the manual pass.** The ⌘⇧T visual check (switch starts off, greys for OpenCode and
Terminal, summary line agrees, ⌘T still plain) needs a restarted app on this build, and the grove
instance running here is a **stale build** whose sessions carry no `sandboxed` field, with live
sessions attached. Restarting it is the human's call. The unit tests cover the logic; what remains
unverified by hand is that the switch *renders* off.

## Deviations and decisions taken inside the slice

15. **This slice touches none of the structure's slice-4 file list except `App.tsx`.** The human
    replaced the ⌘K palette command with the launch dialog on 2026-10-11, so `paletteItems.ts` is
    untouched and `paletteItems.test.ts` — the structure's named verify — is not this slice's test.
    A `grove-design` revise is running to bring `04-structure.md` in line.
16. **Option C (Zed-style where-picker) is explicitly *not* in this slice.** It is a where-list /
    branch-display change, and `2026-10-08-worktree-support` — already approved and complete —
    lists "A GUI worktree flow (palette or dialog)" in its `Deferred`. It belongs to that feature,
    not to sandboxing, and folding it in here would couple this feature to a core question it does
    not need. Recorded for the human; not built.
17. **`sandboxOptIn.ts` is a new module rather than a helper inside `sessionStatus.ts`.** The
    existing live-only strip list in `core.ts` and `types.ts` stay untouched by it — it is a
    renderer-side policy about *asking*, not a fact about a running session.

## Residue

- Nothing left running or on disk from this slice. `reports/` and `research_notes/` remain
  untracked and ignored; nothing from either is staged.
- Another agent has uncommitted work in `NewSessionDialog.tsx`, `ListRow.*`, `worktreeCreate.test.ts`,
  `main/ipc.ts` and `shared/ipc.ts`. Only this slice's hunks were staged; the rest is left as found.

## Open questions

None.

# Slice 3 — Resume stays sandboxed, and a downgrade says so

## What was actually missing

The resume half had landed in 3192da7: `sessionResume` re-enters the sandbox and downgrades when
it cannot, clearing `sandboxed`. **The other half of ADR 0033's bargain — "and the renderer
reports it once in a banner" — was not there.** `sandboxed: false` is the same value a
never-sandboxed session carries, so `SandboxMark` returned `null` and a downgraded session looked
completely ordinary. The one thing on the path that must not be silent was the one thing that
rendered nothing.

`App.tsx:53-59` had a partial answer: it snapshotted `sandboxed` before its own Resume call and
raised a banner if it came back false. That covers one of three resume entry points. The Sidebar's
Resume (`Sidebar.tsx:103`) invokes `session:resume` directly, and the CLI's goes through
`core/send.ts:46`; a downgrade through either showed nothing at all.

The human's decision (2026-10-11) replaced the guessing with a fact the core publishes: a
live-only optional field on `Session`, never saved, alongside `branch`/`status`/`model`, set at
downgrade, rendered by `SessionMeta` next to `SandboxMark`. `sandboxNote` is the name.

## What landed

- **`Session.sandboxNote?: string`** (`src/shared/types.ts`), live-only, and stripped in `set()`
  alongside the other live-only fields so it never reaches `state.json`. A note rather than a
  boolean, because it carries *what happened* rather than only that something did.
- **`sessionResume`** sets it, and only when `session.sandboxed` was actually true — so a session
  that was never sandboxed and is resumed picks up nothing. The value is a fixed sentence from
  `LOST_SANDBOX` in `src/core/sandbox/launch.ts`.
- **`sandboxView(session)`** in `src/renderer/src/sessionStatus.ts`: the one place that decides
  what the mark shows, so the card and the header cannot drift. `sandboxed` | `lost` | `none`,
  with a live sandbox winning over a stale note.
- **`SandboxMark`** takes the session rather than a bare boolean, and renders three shapes: nothing
  for an ordinary unsandboxed session, the existing shield for a sandboxed one, and a new
  **danger-toned shield-off with the word "Not sandboxed"** for a downgraded one. Its tooltip says
  what was lost without pretending to know why.

## Measured, 2026-10-11

Against the **real** `container` 1.5.0 binary, the **real** `resources/sandbox/Dockerfile` and the
**real** login shell (the tmux backend stays fake — there is no pane from this session). Temporary
harness, deleted after the run:

| Step | Result |
| --- | --- |
| create a sandboxed Claude session | ok; real image ref `grove-sandbox:cbcd1e51f27a`; credential probe found `CLAUDE_CODE_OAUTH_TOKEN` in the login shell |
| resume with the image buildable | `sandboxed: true`, **no** `sandboxNote` |
| resume with the Dockerfile moved aside | `sandboxed: false`, `sandboxNote` set, pane argv `export PATH=…:"$PATH"; exec claude -s 8b0ffe7e-…` — on the host |
| `state.json` afterwards | carries `sandboxed` only; **no** `sandboxNote` |

Renderer, rendered to static markup (the renderer has no DOM test environment, so the mark's actual
output was checked rather than assumed):

| Session | Markup |
| --- | --- |
| never sandboxed | `""` — no element at all |
| downgraded | `_mark_ _lost_` classes, shield-off glyph, `Not sandboxed`, `title="Not sandboxed — the sandbox could not start when this session resumed, so its filesystem is not isolated."` |
| sandboxed | `_mark_`, shield glyph, `Sandboxed`, original tooltip **verbatim** |
| either, dense (grid pane) | glyph only, `title` preserved — the tooltip is the only place the reason fits |

`npm test`: **876 passed / 78 files** (was 869; +7). `npm run typecheck`: clean. `npm run build`:
clean.

## Deviations and decisions taken inside the slice

8. **Files beyond the structure's slice-3 list.** `04-structure.md` names `src/core/core.ts` and
   `src/core/sessions.ts`. The slice also touches `src/shared/types.ts` (the field),
   `src/renderer/src/sessionStatus.ts`, `SessionMeta.tsx`, `SandboxMark.tsx`,
   `SandboxMark.module.css` and `ui/Icon.tsx`. Forced by the field being a *rendered* fact, which
   the structure's own outcome line ("Never widens silently") requires and its file list did not
   reach. **`src/core/sessions.ts` needed no change** — `sandboxNote` is set on the spread in
   `sessionResume`, never in `newSession`.
9. **`sandboxView` lives in `sessionStatus.ts`**, not in a new file. It is one small pure function
   beside `statusView`/`statusTone`, which are the same kind of thing, and `SessionMeta` already
   imports from there.
10. **`SandboxMark`'s prop went from `sandboxed: boolean` to `session: Session`.** It needs both
    fields to decide, and passing one boolean in would mean the caller re-deriving the view. Only
    one caller (`SessionMeta.tsx:40`).
11. **A new `shield-off` icon** (the existing shield plus the slash `eye-off` already uses). Not a
    new shape vocabulary — a distinct glyph for the lost state, because reusing the plain shield in
    danger colours reads as "sandboxed and alarming" rather than "not sandboxed".
12. **The note is one fixed sentence, never a diagnosis.** `sandboxArgvFor` collapses every failure
    to `null` deliberately (see its own comment), so the core cannot know whether it was a missing
    binary, a failed build or a missing credential, and inventing a reason string would be a lie.
    `LOST_SANDBOX` names the consequence, which is what the human can act on.
13. **The ad-hoc downgrade banner was removed** on the human's word at slice 3's review. It was
    `App.tsx`'s `downgraded` state: it snapshotted `sandboxed` before its own Resume call and
    raised a banner if the session came back false. With `sandboxNote` on the session the banner
    was redundant *and* wrong twice over — it covered one of three resume entry points (the
    Sidebar's Resume at `Sidebar.tsx:103` and the CLI's through `core/send.ts:46` bypassed it
    entirely), and it inferred the downgrade instead of being told it. Removing it also removed
    `SessionGrid`'s `onResume` prop, which existed only to route through it; the grid pane invokes
    `session:resume` directly again, as the sidebar always did. Every resume path now learns about
    a downgrade the same way — from the session slice core pushes — so none of them can miss it.
14. **The downgraded mark uses `--danger` tokens, not `--accent`.** The accent is what a working
    sandbox wears; reusing it for a lost one would make the two states look like one.

## Carried into slice 4 (human decisions, 2026-10-11)

- **The new-session dialog stays, and the ⌘K palette command is not implemented.** This departs from
  `04-structure.md` slice 4, whose outcome is "⌘K lists **New sandboxed session** … reusing the
  existing ⌘T kind list", and from its `Deferred` list, which explicitly does not want "A
  new-session dialog with a checkbox, instead of a second palette command". `NewSessionDialog.tsx`
  (already in the tree from 3192da7) is the human-approved opt-in instead; the palette command and
  `MenuAction 'newSandboxedSession'` are not to be built. **The artifacts still describe the palette
  command and need a design revise to match** — `grove-design 2026-10-08-agent-sandboxing` in
  revise mode, which should restate slice 4's outcome and drop that line from `Deferred`. Recorded
  here because this file cannot edit `04-structure.md`.
- **`reports/` and `research_notes/` are gitignored and untracked** (`.gitignore:14-15`, commits
  `11971bf` / `7e50b44`). Nothing from either directory is committed by this slice.
- **Slice 6 stays out of scope** while the spike on the opencode v2.0.20 vs image-pinned 1.19.0
  skew runs; D6 may need revising before that slice is planned.
- ADR 0039 / D7 and `gitCommonDir` untouched, as instructed. Slice 1's opencode and terminal
  no-sandbox refusals untouched.

## Residue

- Both temporary verification harnesses (`src/core/zzSlice3Manual.test.ts`,
  `src/renderer/src/zzSlice3Manual.test.ts`) deleted; they were scaffolding, not deliverables.
- `resources/sandbox/Dockerfile` was renamed aside during the manual run and restored in a
  `finally`; `git diff resources/` is empty and the file is 1245 bytes, unmodified.
- No containers were started (the tmux backend was faked), so `container list` is untouched by this
  slice. The image `grove-sandbox:cbcd1e51f27a` remains.
- `reports/` and `research_notes/` remain untracked; `git status --short` shows nothing from them.

## Open questions

None.

---

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

## OpenCode in the sandbox: what slice 6 actually needs (researched 2026-10-11)

Four spikes ran before slice 6 could be planned. Everything below is measured on this machine
unless marked otherwise. **Nothing here is in `03-design.md` yet — D6 still describes the
original, partly-wrong plan, and revising it is `grove-design`'s to do.**

### Decision (the human's, on this recommendation)

**Keep D6's bridge bind.** Use Apple's pf-redirect DNS as the *documented fallback* if the
bridge ever stops working. Rationale: no `sudo`, no host mutation beyond writing one config
value, LAN isolation measured from both directions, and the one real weakness — Apple never
documented it — is precisely what the fallback covers.

### The bridge bind works; the earlier `Errno 49` was a startup race

**A correction to an earlier entry in this file.** The 2026-10-11 spike reported that binding
`192.168.64.1` failed and attributed it, in a later reading, to this Mac having changed network
(`192.168.0.145` → `172.20.10.9`). **That attribution was wrong — the network change is a red
herring.** The real cause is that `bridge100` is created by `container system start`, not at
boot: measured, the container services started 2m24s after boot, and for roughly the first two
and a half minutes the interface does not exist. Bind to a non-existent local address gives
`Errno 49` and `route -n get` falls through to `en0` — exactly the signature recorded. Both the
2026-10-10 success and the 2026-10-11 failure are consistent with this one explanation.

Measured:

- `bridge100: inet 192.168.64.1/24`, member `vmenet1`, `status: active`. Only `.1` is bindable
  (`.2` and `.250` correctly fail) — a real interface, not a catch-all.
- A container reaches it, verified from a fresh container **and** from a live grove sandbox.
- **LAN isolation holds**: the listener is `192.168.64.1:PORT` only; the host's LAN address
  refuses on that port; `192.168.64/24` exists only as a link-scope route on `bridge100`.
  Confirmed independently by two spikes.
- **Discovery is not hardcodeable.** `container network ls --format json` →
  `.status.ipv4Gateway` of network `default`. Proven derived: a network created with
  `--subnet 10.99.0.0/24` yields gateway `10.99.0.1`. grove must read it, never assume `.1`.

**What D6 must add** (mechanical, not a decision): run `container system start` (idempotent),
poll `container network ls` for the gateway, and treat `Errno 49` / `EADDRNOTAVAIL` as *not
ready yet* — retry with backoff. Only a persistent failure past the retry budget becomes
`no-sandbox`. Today D6 says an undiscoverable bridge fails outright, which would reject for
seconds after login on every boot.

### The image's OpenCode is the wrong major version — and the fix is one line

`opencode-ai@2.x` does not exist on npm (`dist-tags.latest` is `1.19.0`; the host's 2.0.20 came
from Homebrew). **But that is not "no npm route"** — an earlier note in this session drew that
conclusion and it was wrong. The package was **renamed and rescoped to `@opencode/cli`**
(official, 27 stable 2.x releases, npm-signature verified, published by OpenCode's author).

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@2.1.296 @opencode/cli@2.0.26 \
 && npm cache clean --force
```

It ships a **self-contained Bun binary**. `ldd` shows **glibc only** — no ICU, no libstdc++, no
loader bottle — so it costs no new apt packages on bookworm. The earlier spike's ~400 MB of
Homebrew-bottle dependencies was the price of the wrong route, not of v2 itself. GitHub Releases
is a 1.x-only channel; building from source is not practical in a Dockerfile.

**Version skew is safe, and grove should not pin the host's version.** Read from the bundled
source: on the `--server` path there is no major-version gate and no feature negotiation — it
warns and proceeds (`Warning: Server ... has version 2.0.20; this client is 2.0.26. Continuing
anyway.`). The *background service* path can hard-fail, and grove does not use it. grove can read
the host's version from the registration file but must **not** bake it into the Dockerfile:
the image is content-addressed on that file alone, and pinning per-host would rebuild it on every
host upgrade.

### Other corrections D6 needs

- **The client seam changed.** v1's `opencode attach <url>` is gone in v2; it is the global
  `--server <url>` flag, which precedes any subcommand. A 1.19.0 client against a 2.x server
  fails with `Request is not supported by this version of OpenCode Server`.
- **Authentication crosses the bridge.** The service requires Basic auth; the container needs
  `OPENCODE_SERVER_PASSWORD` from the registration file's `password`, or it gets 401. Worth
  stating plainly: that secret now crosses a link-scope virtual interface rather than a `0600`
  unix socket. Bounded — `bridge100` has no route from `en0` and grove's existing auth still
  applies — but a weaker boundary than grove's own CLI transport (ADR 0035).
- **Two `service.json` files, easy to confuse.** `~/.config/opencode/service.json` is the
  *config* grove writes (`hostname`, `port`, `password`, `disabled`, `cors`, `env` — the schema
  is closed and rejects anything else); `~/.local/state/opencode/service.json` is the
  *registration* grove reads (`url`, `pid`, `password`, `version`, `id`). grove's
  `serviceFilePath` is correct and needs no change.

### Ruled out, with evidence — do not re-litigate

- **Unix socket transport: impossible.** Both ends closed. The server config rejects every
  socket-shaped key at validation (`Unknown service config key: socket`), `serve --hostname
  /path.sock` dies with `baseURI must have a hostname`, and the client rejects `unix://` at URL
  dispatch — `protocol must be http:, https: or s3:` — with *zero* connection attempts reaching a
  live AF_UNIX listener. The capability exists one layer down in the bundled `effect/http`
  (`UnixAddress`, forwarded to `node:http`'s `server.listen({path})`) but OpenCode never
  constructs it. Worth remembering if upstream ever surfaces it.
- **`socat` on the bridge IP: already reported broken.** In apple/container#346, before Apple
  shipped the pf feature — the same approach grove measured working, failing for someone else.
- **No container→host DNS name exists.** `host.containers.internal`, `host.docker.internal`,
  `gateway` — all NXDOMAIN. `/etc/resolv.conf` in the container is just `nameserver 192.168.64.1`.
- ** grove's own unix-socket fallback remains valid** for grove's CLI (ADR 0035, re-measured
  working this session). It simply does not help OpenCode.

### The documented fallback, and what it would cost

`sudo container system dns create <domain> --localhost <ip>` — Apple PR #1078, merged
2026-01-24, in the installed 1.5.0, documented in the `apple/container` repo's
`docs/host-integration.md`. A pf rule redirects traffic for a fake container-side IP to the
host's `127.0.0.1`, so the service **never leaves loopback**. Apple's stated rationale: *"all pf
redirects target 127.0.0.1"*.

Costs, all documented by Apple: requires `sudo`; **disables iCloud Private Relay**; the pf rule
is **removed on macOS restart**; and the redirect is **whole-IP, all-ports**, so the container
would reach *every* loopback-bound host service, not only OpenCode's port. That last one is why
the bridge bind stays the default despite being undocumented.

Note this retires the `Errno 49` question entirely — Apple never supported a host-side bridge
bind, so its failure is expected behaviour rather than a mystery, and `bridge100` is not
guaranteed stable. If it disappears, the fallback is one command away.

## Carried to the next slice

- **D6 and slice 6's structure entry are stale and must be revised** — see the OpenCode section
  above for the measured recipe. The human chose the bridge bind with Apple's pf redirect as the
  documented fallback. Changes D6 needs: the readiness wait (system start + poll + retry), the
  `@opencode/cli` image line, the `--server` client seam, `OPENCODE_SERVER_PASSWORD`, and the
  corrected statement about the secret crossing a link-scope interface. `grove-design` in revise
  mode owns all of it; this file is not the place.
- **D8's carve-out wording also needs the same revise**: `03-design.md` and `04-structure.md`
  both state the carve-outs unconditionally ("never rewrite it"). They are conditional on the file
  existing. The human chose to keep the mechanism and document the limitation.

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