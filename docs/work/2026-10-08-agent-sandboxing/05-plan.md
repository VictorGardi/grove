---
feature: 2026-10-08-agent-sandboxing
phase: plan
status: approved
version: 4
created: 2026-10-11
updated: 2026-10-11
based_on:
  - 03-design.md@8
  - 04-structure.md@5
forced: []
---

# Agent session sandboxing — plan

Self-approved per slice by grove-implement: mechanical checks passed, not
human-reviewed.

## Slice 1 — Tracer: a sandboxed Claude session runs end to end

### Ground rules for this section

Read this before running anything by hand.

- **The design's `core.ts` line numbers are stale.** The real seam is the
  `backend.create` call in `commands.sessionCreate` and `commands.sessionResume`,
  re-mapped against the code as it is now:
  `sessionCreate` builds `argv` at **core.ts:696-698** and calls `backend.create`
  at **core.ts:699**; `sessionResume` builds `argv` at **core.ts:749** and calls
  `backend.create` at **core.ts:750**. `loginShellArgv` is **not** in core.ts — it
  is `src/core/env.ts:42-45`. `shellOpts()` is core.ts:186. `cliEnv` is
  core.ts:172-185. Ignore every `core.ts:NNN` in `03-design.md`.
- **This slice touches the create seam only.** `sessionResume` stays as it is
  (that is slice 2).
- **`gitCommonDir(dir: string): string | null` already exists** at
  `src/core/git.ts:33-47`. Import it; never reimplement it. Do not touch
  `src/core/worktrees.ts`.
- **Anything run by hand against `container run -i -t` needs a real TTY.**
  From a shell with no TTY on stdin it fails with `NSPOSIXErrorDomain Code=19`
  (ENODEV) and looks exactly like a broken mount subsystem. Use `script -q
  /dev/null <cmd>` or a tmux pane. The mount mechanics are already measured
  (2026-10-10/11); if something fails, it is this code.
- The image tag is `grove-sandbox:<first 12 hex of sha256(Dockerfile bytes)>`, and
  `<GROVE_SOCKET>`/`<GROVE_SESSION_ID>` keep the values `cliEnv` already passes to
  the pane, so the CLI works inside with no new plumbing.

### Tests first

Reading the design's two signatures together: `readOnlyPathsFor(kind, { commonDir,
paths })` takes no `cwd`, so `commonDir` is **already resolved** — non-null only
when the common dir needs a volume of its own (a worktree, or a session started in
a subfolder of a checkout), `null` when it already sits inside the mounted `cwd`
(a plain checkout's own `.git`). `specFor` does that one test; `mountsFor` and
`readOnlyPathsFor` only branch on null.

- [x] Write failing tests `src/core/sandbox/spec.test.ts` covering, in
      `src/core/sandbox/spec.ts`'s functions:
      `mountsFor('claude', { cwd, commonDir: null, paths })` →
      `['<cwd>:<cwd>', '<claudeHome>:<claudeHome>', '<claudeJson>:<claudeJson>',
      '<spoolDir>:<spoolDir>', '<socketPath>:<socketPath>', '<cliBundle>:<cliBundle>']`
      in that order, and with a non-null `commonDir` that volume comes second;
      `mountsFor('opencode', …)` mounts `opencodeShare` and `opencodeConfig`
      instead of the claude pair; a path that is `undefined` in `AgentPaths` is
      skipped rather than mounted as `"undefined"`.
- [x] In the same file: `readOnlyPathsFor('claude', { commonDir: null, paths })` →
      `['<gitconfig>', '<cliBundle>']`, and with a non-null `commonDir` →
      `['<commonDir>/hooks', '<commonDir>/config', '<gitconfig>', '<cliBundle>']`.
- [x] In the same file: `envFor(session, { socketPath: '/s.sock' })` equals exactly
      `GROVE_SESSION_ID: session.id`, `GROVE_SOCKET: '/s.sock'`,
      `TERM: 'xterm-256color'`, `GIT_CONFIG_COUNT: '1'`,
      `GIT_CONFIG_KEY_0: 'core.hooksPath'`, `GIT_CONFIG_VALUE_0: '/etc/grove/no-hooks'`.
- [x] In the same file: `specFor({ kind, name, cwd, commonDir, paths, session })`
      assembles the three above into one `SandboxSpec` (image, mounts,
      readOnlyPaths, env, cwd, container, cliBundle); it passes `commonDir`
      through when it does **not** start with `cwd + path.sep`, and `null` when
      it does (so a plain checkout, and a session in one of its subfolders, get
      no carve-outs) or when `gitCommonDir` returned `null`.
- [x] Write failing tests `src/core/sandbox/argv.test.ts`: `sandboxArgv({ name,
      spec, agentArgv: ['claude', '-s', 'id'] })` equals exactly
      `['container', 'run', '--rm', '-i', '-t', '--name', <name>, '--workdir',
      <cwd>, '--volume', <m1>, …, '--read-only-path', <r1>, …, '-e',
      '<K>=<V>', …, '-e', 'GROVE_CLI_BUNDLE=<cliBundle>', <image>, 'claude', '-s',
      'id']` — every mount flattened to one `--volume`, every read-only path to
      one `--read-only-path`, every env entry to one `-e K=V`, the image last
      before the agent argv; a `spec` with no `cliBundle` emits no
      `GROVE_CLI_BUNDLE`.
- [x] Write failing tests `src/core/sandbox/image.test.ts`: `imageRef(<temp
      Dockerfile>)` is `grove-sandbox:` plus the first 12 hex of
      `sha256(<its bytes>)`, and two files with different bytes give two
      different refs while the same bytes give the same ref twice.
- [x] In the same file: `ensureImage({ container, dir, tag })` against a fake
      `container` shell script on a temp dir that records its argv — when
      `image ls --quiet` prints the tag it runs no build; when it prints nothing
      it runs `build -t <tag> <dir>`; a build that exits non-zero rejects.
- [x] Add to `src/core/store/stateStore.test.ts`: a v8 file migrates to
      `schemaVersion 9` with every session's `sandboxed` `false`, a saved
      `sandboxed: true` survives, and the existing unknown-version fixture moves
      from `{"schemaVersion":9}` to `{"schemaVersion":10}`. Change every other
      hardcoded `8` in the file to `9`.
- [x] Add to `src/core/sessionCreate.test.ts`: `sessionCreate({ kind: 'claude',
      sandboxed: true, … })` on a core whose `sessionEnv` and `sandbox` point at
      temp dirs and a fake `container` script asserts `created(t.fake)[0].argv![4]`
      matches
      `/^export PATH=\/bin:"\$PATH"; exec container run --rm -i -t --name grove-/`
      and contains `--workdir <cwd>`, one `--volume <cwd>:<cwd>`, and the agent
      argv last; and `sandboxed` defaults to `false` so an unsandboxed claude
      session's argv is still `exec claude …` with no `container run`.
- [x] Add to `src/cli/args.test.ts`: `['new', 'claude', '--sandboxed']` parses to
      `sandboxed: true`, `['new', 'claude']` to `sandboxed: false`, and
      `--sandboxed` is not accepted by any other command.
- [x] Add to `src/main/cliServer.test.ts`: `sessions.create` with
      `sandboxed: true` for kind `claude` over a real socket yields a session
      whose `sandboxed` is `true` (assert through `core.getSlices()`).

### Implement

- [x] Create `resources/sandbox/Dockerfile`: `FROM node:22-slim`; `apt-get install
      -y --no-install-recommends git ripgrep jq ca-certificates`;
      `mkdir -p /etc/grove/no-hooks`; `npm install -g
      @anthropic-ai/claude-code@2.1.296 opencode-ai@1.19.0` (both pinned); and a
      `/usr/local/bin/grove` shim, mode 755, whose body is
      `GROVE_CLI_BUNDLE=${GROVE_CLI_BUNDLE:?…}` then
      `exec node "$GROVE_CLI_BUNDLE" "$@"`. The bundle is **not** baked — it is
      mounted read-only at its host path and its path arrives in
      `GROVE_CLI_BUNDLE`, so a grove upgrade never invalidates the tag.
- [x] Create `src/core/sandbox/spec.ts`: `AgentPaths`, `SandboxSpec`,
      `mountsFor`, `readOnlyPathsFor`, `envFor`, `specFor`. `specFor` composes the
      three functions and nothing else; it decides no policy the design did not
      already make. A common dir already inside `cwd` (a plain checkout's own
      `.git`) is not mounted separately and takes no carve-outs.
- [x] Create `src/core/sandbox/argv.ts`: `sandboxArgv({ name, spec, agentArgv })`
      returning the flat argv above. No I/O, no spawn.
- [x] Create `src/core/sandbox/image.ts`: `imageRef(dockerfile: string): string`
      (sha256 of the file's bytes, first 12 hex) and
      `ensureImage({ container, dir, tag }): Promise<void>` using
      `execFile`/`execFileSync` on `container image ls --quiet` then
      `container build -t <tag> <dir>`; a non-zero exit rejects.
- [x] `src/shared/types.ts`: add `sandboxed: boolean` to `Session` (persisted, so
      **not** in core.ts's live-only strip list) and change `StateFile.schemaVersion`
      to `9`.
- [x] `src/core/sessions.ts`: `newSession` takes `sandboxed?: boolean` and sets
      `sandboxed: o.sandboxed ?? false`.
- [x] `src/core/store/stateStore.ts`: add
      `const v8ToV9 = (s: { sessions?: Session[] }) => ({ …s, sessions: (s.sessions ?? []).map((x) => ({ ...x, sandboxed: x.sandboxed ?? false })) })`
      in the file's existing style, register it as `8: v8ToV9` in the migration map
      in `loadState`, and raise both `8`s on that line to `9`.
- [x] `src/core/core.ts`: raise the hardcoded `schemaVersion: 8` on the
      `saveState` call (core.ts:202) to `9`. Add `sandbox?: { container: string;
      dockerfile: string }` to `CoreOptions`. Widen
      `sessionEnv` to `{ socketPath: string; binDir: string } & Partial<AgentPaths>`
      — every new key optional, so `src/core/cliEnv.test.ts` keeps compiling and
      passing untouched. Add `sandboxed?: boolean` to `Commands.sessionCreate`'s
      arguments. In `sessionCreate`: after the `no-feature` check and **before**
      `source.mintId`, return `{ ok: false, error: 'no-sandbox' }` when
      `sandboxed` is set and `kind` is `terminal` or `opencode` (slice 1 runs
      Claude only; a sandboxed OpenCode must not be allowed to start its own
      service before D6 lands, and a terminal has no agent argv to wrap). At the
      argv seam (core.ts:696-698): when `sandboxed`, `await ensureImage` inside a
      `try` and on failure return `{ ok: false, error: 'no-sandbox' }`; otherwise
      compose `specFor(...)` and pass `sandboxArgv({ name: session.tmuxName,
      spec, agentArgv })` as the argv that `loginShellArgv` wraps — leaving the
      unsandboxed branch and the `backend.create` call itself untouched.
      `sessionResume` is **not** touched.
- [x] `src/shared/cli.ts`: add `sandboxed?: boolean` to `CliMethods['sessions.create']`'s
      params.
- [x] `src/cli/args.ts`: add `sandboxed: boolean` to the `new` arm of `Command`,
      `sandboxed: { type: 'boolean' }` to its options, `sandboxed: !!values.sandboxed`
      to the returned literal, and one usage line.
- [x] `src/cli/index.ts`: pass `sandboxed: cmd.sandboxed` in the `sessions.create`
      params of the fall-through branch.
- [x] `src/main/cliServer.ts`: pass `sandboxed: params.sandboxed === true` into
      `core.commands.sessionCreate`. **Do not** add a `no-sandbox` entry to
      `MESSAGES` — that is slice 6's file; until then `failFrom` falls back to the
      bare code, which is its documented behaviour.
- [x] `src/main/index.ts`: hoist the existing `spoolDir` (index.ts:76) and
      `cliBundle` (index.ts:60) locals; build the full `AgentPaths` from
      `os.homedir()` and `process.env` (honouring `CLAUDE_CONFIG_DIR`, `XDG_*`,
      and reusing `serviceFilePath` for `opencodeServiceConfig`) and pass it as
      `sessionEnv`'s extra keys; pass
      `sandbox: { container: 'container', dockerfile: path.join(app.getAppPath(), 'resources', 'sandbox', 'Dockerfile') }`.
- [x] `package.json`: add `"out/main/cli.js"` to `build.asarUnpack`, so a packaged
      build leaves the CLI bundle bind-mountable (D7).

### Verify

- [x] `npm test`
- [x] `npm run typecheck`
- [x] In a tmux pane, `npm run dev`, then `grove new claude --sandboxed --prompt
      "print pwd"`: the real Claude Code starts in the container and renders its TUI.
      **Partly blocked:** it then stops at "Select login method", so the two checks that
      need an authenticated agent — *a `touch` there appears in grove's diff*, and *the card
      shows a status* — were not run. The rest were, with the same argv and a shell in place
      of the agent, and with `node` in place of `curl` (the image carries no curl): `ls $PWD`
      is the project; a write outside the mount set never reaches the host; `grove ls`
      answers; `api.anthropic.com` answers 401 while host ports 49152/5000/7000 refuse;
      `~/.gitconfig` and the CLI bundle are read-only. See `06-implementation.md`.
- [x] In the same pane: `git rev-parse --show-toplevel` matches, `git config --get
      core.hooksPath` is `/etc/grove/no-hooks`, and a real `git commit` lands
      (the ADR 0038 obligation, repeated driven by the real agent).
- [x] Remove every container, throwaway worktree and temp path the verification
      created; keep only the `grove-sandbox:*` image, which is the feature's.
## Slice 2 — A sandboxed session authenticates, or grove refuses (D8)

Re-planned after `03-design.md` v8 / `04-structure.md` v5; slice 1 (58c4e1f) is done and
untouched. Context a fresh agent needs, inlined: the container runs `uid=0` with
`HOME=/root`, so both agents resolve `~` to `/root` while grove mounts the host's config at
`/Users/victor/…` — those volumes are present and unread, which is why a sandboxed Claude
session stops at "Not logged in". `container run -e VAR` with no `=value` forwards the
variable from the calling process's environment and still works when the caller is
`$SHELL -l -i -c` (measured), which is the pane grove already builds. A bare `-e VAR` for a
variable that is *not* set does **not** fail the run, so absence must be probed, not
attempted.

- [x] `src/core/sandbox/spec.test.ts` — `envFor('claude', SESSION, { paths: PATHS })` equals
      the existing six entries **plus** `CLAUDE_CONFIG_DIR: '/home/u/.claude'` and
      `passEnv: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']`; `envFor('opencode', …)`
      adds `XDG_DATA_HOME: '/home/u/.local/share'` and
      `XDG_CONFIG_HOME: '/home/u/.config'` and carries **no** `CLAUDE_CONFIG_DIR` and no
      `passEnv`; `readOnlyPathsFor('claude', …)` gains
      `/home/u/.claude/settings.json` and `/home/u/.claude/.credentials.json`;
      `readOnlyPathsFor('opencode', …)` gains `/home/u/.local/share/opencode/auth.json`;
      each of the two kinds excludes the other's carve-outs; a path that was never resolved
      contributes no carve-out; `specFor` threads `passEnv` through.
- [x] `src/core/sandbox/argv.test.ts` — a `passEnv` entry reaches the argv as exactly
      `['-e', 'CLAUDE_CODE_OAUTH_TOKEN']`, with no `=` anywhere in it, after the `-e K=V`
      block and before the image.
- [x] Implement `src/core/sandbox/spec.ts`: add `passEnv?: string[]` to `SandboxSpec`;
      change `envFor(kind, session, o: { paths: MountPaths })` — `kind` first — to return
      `{ env, passEnv }`; derive `XDG_DATA_HOME`/`XDG_CONFIG_HOME` with
      `path.dirname(opencodeShare)` / `path.dirname(opencodeConfig)`; append the three
      carve-outs in `readOnlyPathsFor`; thread both through `specFor`.
- [x] Implement `src/core/sandbox/argv.ts`: after the `-e K=V` entries, emit
      `...(s.passEnv ?? []).map((k) => '-e', )` as `flatMap((k) => ['-e', k])`.
- [x] Create `src/core/sandbox/auth.ts` exporting
      `loginShellCredential(kind, o: { shell: string; claudeHome?: string }): Promise<string | null>`
      returning a **human label** of the credential the session will use, or null. For
      `'claude'`: spawn `<shell> -l -i -c 'echo ${VAR:-}'` once per candidate in order
      `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`; the first non-empty wins and its name
      is the label; otherwise if `<claudeHome>/.credentials.json` exists return
      `'~/.claude/.credentials.json'`; otherwise null. For `'opencode'` return
      `"the host's opencode auth.json, or the free tier"` immediately, **without spawning**.
      A spawn error, timeout or empty output is "not found", never a throw.
- [x] Create `src/core/sandbox/auth.test.ts` against a fake `shell` script written to a temp
      dir and marked executable: set/unset per variable, `.credentials.json` present and
      absent, first-match-wins ordering, opencode never spawning (assert the fake shell's
      marker file was not created).
- [x] `src/core/sessionCreate.test.ts` — `sessionCreate({ kind: 'claude', sandboxed: true })`
      returns `{ ok: false, error: 'no-sandbox' }` when `loginShellCredential` resolves null,
      and creates the session when it resolves a label; an unsandboxed claude create never
      probes.
- [x] `src/core/core.ts` — in the `sandboxKind` branch, after `ensureImage` and before
      `specFor`, `const credential = await loginShellCredential(sandboxKind, { shell: process.env.SHELL || '/bin/zsh', claudeHome: paths.claudeHome })`;
      `if (!credential) return { ok: false, error: 'no-sandbox' }`. Store the label on the
      spec's `credential` field so the card can name it; do not persist it on `Session`.
- [x] `src/core/sandbox/spec.ts` — add `credential?: string` to `SandboxSpec` and populate
      it from the label above; absent means "nothing forwarded".
- [x] `src/main/cliServer.ts` — add to `MESSAGES`: `'no-sandbox'` →
      `'this machine cannot give a sandboxed session what it needs — install and start the `container` CLI, or run `claude setup-token` and export CLAUDE_CODE_OAUTH_TOKEN in your shell profile'`.
- [x] **Deferred to slice 4**, which owns the sandbox tag this would attach to — the card step
      (`src/renderer/src/components/SessionCard.tsx` in the original wording; no such file
      exists and no component renders a sandbox tag). `SandboxSpec.credential` is populated and
      tested, so slice 4 only has to render it. See `06-implementation.md`.
- [x] `npm test`
- [x] `npm run typecheck`
- [x] Manual, **under a real controlling TTY** (`container run -i -t` fails with ENODEV without
      one and looks like a broken mount subsystem). Wrapped in `script -q /dev/null`, with a
      **dummy** `CLAUDE_CODE_OAUTH_TOKEN` — never the real one, the Keychain secret must not
      enter a container: the TUI renders **past** the login screen and answers (failing at the
      API with a 401 on the dummy token, which is what proves the channel works);
      `CLAUDE_CONFIG_DIR` reaches the host config and the host's `settings.json` is read and
      applied inside; the token arrives with no `=` in the argv; writing to `settings.json`
      from inside gives `EROFS`; `opencode auth list` inside resolves to the **host** path
      `/Users/victor/.local/share/opencode/auth.json`. Not run: the populated-provider case
      (no host OpenCode login on this machine — slice 6 owns it) and the end-to-end refusal
      through a live app (asserted in `cliServer.test.ts` instead).

### Decision: D8's carve-outs stay `--read-only-path` (option B)

`--read-only-path` enforces nothing when the target is absent on the host, and
`.credentials.json` is absent on precisely the machines D8 was written for. Measured
2026-10-11; the evidence, the rejected alternative and the reachability analysis are in
`06-implementation.md`.

**The human chose B: keep the mechanism, document the limitation.** The cross-check that made
it a close call is in `06-implementation.md` — grove's own refusal plus Anthropic's published
credential precedence means no reachable configuration leaves that gap consequential. Option A
(read-only parent plus writable nested re-binds) was measured working and remains the honest
upgrade if the broader goal is ever wanted: *nothing* in `~/.claude` writable except a
maintained list. That is its own feature, deliberately not smuggled in here.

Consequence still owed: `03-design.md`'s D8 and `04-structure.md`'s slice-2 outcome both state
the carve-outs unconditionally ("never rewrite it"). They are conditional on the file existing.
Correcting that wording is `grove-design`'s to make, not this skill's.

## Slice 3 — Resume stays sandboxed, and a downgrade says so

State on entry: `sessionResume` already re-enters the sandbox (slice 1's `sandboxArgvFor` seam,
`core.ts:799-807`) and downgrades when it cannot, clearing `sandboxed`. **What is missing is the
second half of ADR 0033's bargain — the "and says so".** Nothing records *that* a downgrade
happened; `sandboxed: false` is indistinguishable from a session that was never sandboxed, so
`SandboxMark` returns null and the session looks ordinary on the one path that must not be
silent. `App.tsx:53-59` papers over this for its own Resume button only, by snapshotting
`sandboxed` before the call — and misses the Sidebar's Resume, which invokes `session:resume`
directly (`Sidebar.tsx:103`), and the CLI's, which goes through `core/send.ts:46`.

The live-only field below replaces that guessing with a fact the core publishes. Name: the human
chose this shape on 2026-10-11 — a live-only optional field on `Session`, never saved, alongside
`branch`/`status`/`model`, set at downgrade, rendered by `SessionMeta` next to `SandboxMark`.
`sandboxNote` is the name; it is a note, not a boolean, because it carries *what happened* rather
than only that something did.

Files beyond the structure's list (`src/core/core.ts`, `src/core/sessions.ts`): `src/shared/types.ts`
for the field, and the renderer's `SessionMeta.tsx` / `SandboxMark.tsx` / `SandboxMark.module.css`.
Logged as a deviation.

### Tests first

- [x] Add to `src/core/sessionCreate.test.ts`'s `sessionResume --sandboxed` block: after the
      existing downgrade test removes the Dockerfile, `res.data.sandboxNote` is a non-empty
      string and `res.data.sandboxed` is `false`.
- [x] In the same file: a sandboxed resume that **succeeds** leaves `sandboxNote` unset, and a
      session that was never sandboxed and is resumed has no `sandboxNote` either — the note is
      only ever set by a downgrade.
- [x] In the same file: `sandboxNote` is **never saved**. Resume a sandboxed session with the
      Dockerfile gone, then assert `loadState(statePath).sessions[0]` has no `sandboxNote`
      property (mirrors the `branch` assertion at `src/core/sessions.test.ts:87`).
- [x] Add a `describe('sandboxView')` to `src/renderer/src/sessionStatus.test.ts` covering the new
      pure function in `src/renderer/src/sessionStatus.ts`:
      `sandboxView({ sandboxed: true })` → `{ state: 'sandboxed', label: 'Sandboxed' }`;
      `sandboxView({ sandboxed: false })` → `{ state: 'none' }` (no label);
      `sandboxView({ sandboxed: false, sandboxNote: 'x' })` → `{ state: 'lost', label: <the lost
      label> }`; and `sandboxView({ sandboxed: true, sandboxNote: 'x' })` → still `sandboxed`
      (a live sandbox wins over a stale note).

### Implement

- [x] `src/shared/types.ts`: add `sandboxNote?: string` to `Session`, after `model`, commented as
      live-only and never saved — the same shape and comment as `branch`/`status`/`model`.
- [x] `src/core/core.ts`: add `sandboxNote: _n` to the live-only strip list in `set()` (the
      `sessions.map(({ branch: _branch, … })` destructure at core.ts:209-211), so it is never
      written to `state.json`.
- [x] `src/core/core.ts`: in `sessionResume`, when `built` is null **and** `session.sandboxed` was
      true, replace the session with `{ ...session, sandboxed: false, sandboxNote: <note> }`
      instead of `{ ...session, sandboxed: false }`. The note is a fixed, honest sentence naming
      what the human must know: the sandbox could not start, so this session is on the host with
      no filesystem isolation. Never invent a reason string here — `sandboxArgvFor` collapses every
      failure to `null` on purpose (see its own comment), so core cannot name which one it was.
- [x] `src/renderer/src/sessionStatus.ts`: add `sandboxView(s: Session): { state: 'sandboxed' |
      'lost' | 'none'; label?: string }` — the one place that decides what the mark shows, so
      `SessionMeta` and `SandboxMark` cannot drift. Move `SandboxMark`'s existing `HINT` constant
      and its `sandboxed` prop's behaviour behind it.
- [x] `src/renderer/src/components/ui/SandboxMark.tsx`: take the view from `sandboxView` instead of
      a bare `sandboxed` boolean; render nothing for `none`, the existing shield for `sandboxed`,
      and a **distinct, danger-toned** mark for `lost` (shield with a slash, the word `Not
      sandboxed`) whose `title` says the sandbox could not start. Keep the existing tooltip on the
      sandboxed case verbatim. Use the existing `--danger` / `--danger-bg` / `--danger-border`
      tokens, not new colours.
- [x] `src/renderer/src/components/ui/SandboxMark.module.css`: add the `.lost` variant alongside
      `.mark`/`.compact` in the same danger tokens `Banner.module.css` uses. No new token.
- [x] `src/renderer/src/components/SessionMeta.tsx`: pass `session` to `SandboxMark` instead of
      `sandboxed={session.sandboxed}`, keeping it in the same place in the row (after the spacer,
      before `actions`) so the content header and the grid pane both get it.

### Verify

- [x] `npm test` — expect 869 passing plus the new assertions; `src/core/sessionCreate.test.ts`
      and `src/renderer/src/sessionStatus.test.ts` are the two that must change.
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] Manual, in `npm run dev`: resume a sandboxed Claude session (⌘T → Claude Code with the
      sandbox on, or `grove new claude --sandboxed`), stop it, then **rename the Dockerfile on the
      host** so `imageRef`/`ensureImage` fails and the resume downgrades. The session must come back
      running, unsandboxed, with the danger mark and the note visible in the content header and in
      its grid pane. Do the same from the Sidebar's Resume — the path the old banner missed — and
      confirm the mark appears there too.
- [x] Manual, clean-up: confirm `git status` shows `reports/` and `research_notes/` still
      untracked and nothing from them staged, and that no `sandboxNote` appears in `state.json`.

## Slice 4 — Opting in from the launch dialog, and seeing it on the card

**Re-planned against the code as it is after slice 3, under the human's 2026-10-11 decision that
the launch dialog is the opt-in.** `04-structure.md` slice 4 describes a ⌘K palette command
(`MenuAction 'newSandboxedSession'`, `newSessionItems(projects, projectId, sandboxed, create)`) and
its `Deferred` list rules out "A new-session dialog with a checkbox, instead of a second palette
command". The human kept the dialog and dropped the palette command. **So this slice does not touch
`paletteItems.ts` at all, and the structure's file list and verify line no longer describe it** —
`paletteItems.test.ts` is not the test here. `04-structure.md` needs a design revise to match; it is
not this skill's to edit.

State on entry: the plumbing is already complete and correct. `InvokeMap['session:create']` carries
`sandboxed?: boolean` (`src/shared/ipc.ts:18`), `main/ipc.ts:44` forwards the whole argument to
`core.commands.sessionCreate`, and `App.tsx:142` sends the flag. `SandboxMark` already names the
filesystem on the card and header. **Two defects are what is left**, both in the dialog.

The first is a design violation, and it is the important one:

> `03-design.md:27` — "Opt-in is per session … **Default off**." `01-questions.md:18` — "not a
> default for every session"; `:76` — "explicit per-session decision". ADR 0033 rejects "making
> sandboxing the default" as its third rejected option.

`NewSessionDialog.tsx:47` is `useState(true)`. Every Claude session launched from ⌘⇧T is therefore
sandboxed whether or not the human asked — the opposite of the one thing all three artifacts agree
on, and the most consequential possible default for a feature whose whole point is opt-in
containment.

The second is duplication: the rule "only Claude is sandboxable" is written twice, once as
`sandboxable` in the dialog and again inline as `l.kind === 'claude' && l.sandboxed` in
`App.tsx`. They answer different questions — what the form *offers* versus what it *sends* — and
nothing keeps them equal. When OpenCode becomes sandboxable in slice 6, one would move and the
other would not.

### Tests first

- [x] Create `src/renderer/src/sandboxOptIn.test.ts` for the module below:
      `sandboxable('claude')` is true and `sandboxable('opencode')` and `sandboxable('terminal')`
      are false; `wantsSandbox('claude', true)` is true; `wantsSandbox('claude', false)` is false;
      and **`wantsSandbox` is false for `opencode` and `terminal` even when the flag is true** —
      the guard that keeps an unsandboxable kind from reaching core and being refused `no-sandbox`;
      `SANDBOX_DEFAULT` is `false`.
- [x] Add to `src/core/sessionCreate.test.ts` (extend the existing `sessionCreate --sandboxed`
      block, do not add a new file): with `sandboxed` absent the created session is `sandboxed:
      false` and the pane argv carries no `container run` — the "default off" half, asserted where
      the default actually takes effect rather than only where it is written down.

### Implement

- [x] Create `src/renderer/src/sandboxOptIn.ts` with three exports and the reasons in comments:
      `sandboxable(kind: SessionKind): boolean` — only Claude, citing ADR 0034 / D6 exactly as the
      dialog's existing comment does; `wantsSandbox(kind: SessionKind, sandboxed: boolean):
      boolean` — `sandboxable(kind) && sandboxed`; `SANDBOX_DEFAULT = false`, citing the design's
      "Default off" and ADR 0033's rejected "making sandboxing the default".
- [x] `src/renderer/src/components/NewSessionDialog.tsx`: delete the local `sandboxable` and import
      it from `sandboxOptIn`; change `useState(true)` to `useState(SANDBOX_DEFAULT)`; use
      `wantsSandbox(kind, sandboxed)` for the summary line at the foot so the wording and the
      toggle's own `aria-checked` cannot disagree. Change nothing else in the file — another
      agent has uncommitted work in it, so stage hunks, never the whole file.
- [x] `src/renderer/src/App.tsx`: replace `sandboxed: l.kind === 'claude' && l.sandboxed` with
      `sandboxed: wantsSandbox(l.kind, l.sandboxed)`, importing from `sandboxOptIn`.

### Verify

- [x] `npm test` — 876 passing plus the new assertions. `src/renderer/src/sandboxOptIn.test.ts` is
      new; `src/core/sessionCreate.test.ts` gains one case.
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] Manual, in `npm run dev`: ⌘⇧T, leave the kind on Claude Code — **the Isolation switch must
      start off**, and the summary line must read "· on your host". Turn it on; the summary must
      read "· sandboxed". Start; the session must come up inside its container and its card must
      carry the "Sandboxed" mark. Open ⌘⇧T again, switch the kind to OpenCode and to Terminal —
      the switch must go grey and the summary must read "· on your host" even though the toggle
      was left on for Claude. Confirm ⌘T still starts a plain, unsandboxed session.
- [x] Clean-up: `git status` shows nothing from `reports/` or `research_notes/`, and the other
      agent's uncommitted files are still present and unstaged.
