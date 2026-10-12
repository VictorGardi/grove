---
feature: 2026-10-08-agent-sandboxing
phase: plan
status: approved
version: 8
created: 2026-10-11
updated: 2026-10-12
based_on:
  - 03-design.md@10
  - 04-structure.md@7
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

## Slice 5 — Teardown, and pruning what a crash left behind

Re-planned fresh against design v9 / structure v6. Slices 1–4 are done and untouched. Context a
fresh agent needs, inlined:

- **The seam.** A session's container is named after its tmux session: `sandboxArgv` emits
  `container run --name <session.tmuxName>` (`src/core/sandbox/argv.ts:14-15`) and
  `Session.tmuxName` is `grove-${session.id}` (`src/shared/types.ts:18`). So the name to remove is
  a field core already has.
- **Why `container rm -f` is needed at all.** `--rm` takes the VM with a *clean* agent exit. A
  SIGKILLed `container run` never fires it, so the container outlives the pane. `backend.kill`
  SIGKILLs the pane, so every ⌘W needs the explicit removal.
- **`container` 1.5.0's real surface**, measured on this machine with read-only commands only:
  `container list [--all] [--format json] [--quiet]` — plain `list` prints **running** containers
  only, `-q` prints one name per line, `--all` includes stopped ones; `container rm` is the
  `delete` subcommand and takes `-f`; `container network ls --format json` is slice 6's.
- **A crash's two leftovers.** A pane whose `container run` was SIGKILLed leaves a **stopped**
  container, which plain `list` omits, and a pane still alive under tmux keeps a running one.
  Prune must therefore list `--all`, and must skip anything a live tmux session still owns.
- `backend.list(): Promise<Set<string>>` — the live tmux names (`src/core/backend/types.ts:13`).

### Tests first

- [x] Create `src/core/sandbox/container.test.ts` against a fake `container` shell script written
      to a temp dir and marked executable, recording every invocation's argv in a log (the shape
      `src/core/sandbox/image.test.ts` already uses): `removeContainer(file, 'grove-abc')` runs
      exactly `rm -f grove-abc`; a script that exits 1 with `Error: no such container` on stderr
      still **resolves** (never rejects), as does a path to a binary that is not there at all.
- [x] In the same file: `pruneContainers(file, ['grove-live'])` against a `container list --all
      --quiet` that prints `grove-live`, `grove-dead`, `grove-orphan` and `someone-elses-box` calls
      `list --all --quiet` once and then `rm -f grove-dead` and `rm -f grove-orphan` and nothing
      else — never `grove-live`, never the container that is not grove's.
- [x] In the same file: a `list` that exits non-zero (the system is not running) prunes nothing and
      resolves; an empty `list` prunes nothing.
- [x] Add to `src/core/sessionCreate.test.ts`'s existing `describe('sessionCreate --sandboxed')`
      block, beside the block's `start()` a `startWithLog(listOutput)` helper whose fake `container`
      appends `"$@"` to a log file and exits 0 — `start()` itself must keep working unchanged:
      killing a sandboxed session runs `rm -f <its tmuxName>`; removing one does the same; and
      killing an **unsandboxed** session runs no `container` command at all.
- [x] In the same block: `start()` against a fake whose `list --all --quiet` prints a `grove-*`
      name with no live tmux session records `rm -f <that name>`; a `grove-*` name that **is** a
      live tmux session name (`t.fake.live.add(name)` before `core.start()`) is left alone.

### Implement

- [x] Create `src/core/sandbox/container.ts`:
      `export function removeContainer(container: string, name: string): Promise<void>` running
      `container rm -f <name>` through `execFile` and resolving whatever the exit status, with a
      comment saying why it cannot reject (a container that will not be removed must not fail the
      ⌘W that came with it, and `start` prunes whatever is left);
      `export async function pruneContainers(container: string, live: Iterable<string>): Promise<void>`
      running `container list --all --quiet`, reading the names one per line, and calling
      `removeContainer` for every name matching `/^grove-/` that is not in `live` — a failing
      `list` yielding no names, never a rejection. That prefix is what keeps grove from deleting a
      container it did not start.
- [x] `src/core/core.ts`: import `pruneContainers, removeContainer` from `./sandbox/container`, and
      add one helper beside `sandboxDeps()` (core.ts:201):
      `const dropContainer = (session: Session) => session.sandboxed && opts.sandbox ? removeContainer(opts.sandbox.container, session.tmuxName) : Promise.resolve()`.
- [x] `src/core/core.ts` `sessionKill` (core.ts:787): `await dropContainer(session)` immediately
      after `await backend.kill(session.tmuxName)` and before the `markGone` re-read.
- [x] `src/core/core.ts` `sessionRemove` (core.ts:798): the same `await dropContainer(session)`
      immediately after its `await backend.kill(session.tmuxName)`.
- [x] `src/core/core.ts` `start()` (core.ts:980): inside the existing `try` around
      `backend.ensureConfig()`, capture the live names once — `const live = await backend.list()` —
      and pass them to `reconcile`; then, after the `set('sessions', next)` line,
      `if (opts.sandbox) await pruneContainers(opts.sandbox.container, live)`. Inside the `try` on
      purpose: `live` comes from tmux, and without tmux grove cannot tell an orphan from a running
      session, so nothing is pruned. `pruneContainers` cannot reject, so a prune failure is never
      reported as a tmux failure.

### Verify

- [x] `npm test` — 911 passed / 81 files (was 900 / 80; +11).
- [ ] `npm run typecheck` — **`typecheck:node` clean; `typecheck:web` fails on
      `src/renderer/src/components/NewSessionDialog.tsx` (TS1005 at :308/:313), which another
      agent is editing uncommitted right now.** Verified as not this slice's: a detached worktree
      at HEAD `25e228d` typechecks `tsconfig.web.json` clean. Re-run once their file lands.
- [ ] `npm run build` — **main and preload bundles built clean** (`out/main/index.js` 157.52 kB,
      `out/main/cli.js` 10.48 kB — every file this slice touches is in that bundle); the renderer
      **client** build fails on the same foreign `NewSessionDialog.tsx`. Re-run once it lands.
- [ ] **NOT RUN HERE — manual, and it needs a live app on this build** (the grove instance on this
      machine is a stale build with live sessions attached; restarting it is the human's call): in
      `npm run dev`, start a sandboxed session, ⌘W it, and `container list` shows nothing; then
      `container run -d --name grove-orphan sleep 600`, restart the app, and it is gone. Left
      unticked on purpose.

## Slice 6 — OpenCode in the sandbox, joining the host's service (D6)

Re-planned fresh against design v9 / structure v6, and against the four spikes recorded in
`06-implementation.md` under "OpenCode in the sandbox". Slices 1–5 are done and untouched.

### What slice 6 has to be true about

- **Why it cannot just run `opencode` in the container.** A second registration **evicts** the
  incumbent (measured: within 3 s service A was dead, no listening socket, the registration read as
  B). A sandboxed OpenCode starting its own service would take down status, waiting, notifications
  and write-driven linking for **every** OpenCode session on the host. `--read-only-path
  <opencodeState>` is the backstop that makes eviction impossible rather than merely unlikely.
- **How the container finds the service.** The host service writes its reachable `url` into the
  **registration** file at `$XDG_STATE_HOME/opencode/service.json` — measured: bound to
  `0.0.0.0` it registered `url=http://0.0.0.0:49558`, bound to the bridge it registers
  `url=http://192.168.64.1:49561`. So the container reads the registration itself, **and only if
  `XDG_STATE_HOME` points at the host's state dir**. Without that pointer the client looks in
  `/root/.local/state/opencode`, finds nothing, starts its own service, and D6's hazard is back.
  This is the same one-pointer-at-a-mounted-path mechanism D8 established for `XDG_DATA_HOME` and
  `XDG_CONFIG_HOME`; `XDG_STATE_HOME` is the third pointer and it was missing from design v9's spec
  block.
- **Two `service.json` files, and the names in the tree are wrong.** `~/.config/opencode/service.json`
  is the **config** grove writes (`hostname`, `port`, `password`, `disabled`, `cors`, `env`; closed
  schema). `~/.local/state/opencode/service.json` is the **registration** grove reads (`url`, `pid`,
  `password`, `version`, `id`). `AgentPaths.opencodeServiceConfig` currently holds the *registration*
  path (it is what `HttpOpenCode` watches), under the config's name. This slice gives each field the
  name it deserves.
- **The bridge address is derived, never assumed.** `container network ls --format json` on this
  machine returns exactly one array element:
  `[{"configuration":{…,"name":"default",…},"status":{"ipv4Gateway":"192.168.64.1","ipv4Subnet":"192.168.64.0/24",…}}]`.
  A network created with `--subnet 10.99.0.0/24` yields `10.99.0.1`, so `.1` is a coincidence.
- **The bridge is not there at boot.** `bridge100` is created by `container system start`, measured
  2m24s after login. So: run `system start` (idempotent), then poll with backoff. Only a failure
  **past the budget** is `no-sandbox`. grove itself never binds, so it never sees the `Errno 49`
  the service would — the retry covers the same window, from the other side.
- **The service reads its config at start.** grove writing the bind does not rebind a running
  service. This is stated as a fact here and carried as an open item; it is **not** worked around in
  this slice, because restarting the human's OpenCode service is not a decision design v9 or
  structure v6 makes.

### Carried forward, and not worked around here

- **`03-design.md`'s two-way table says grove writes the bridge address "with a consent prompt the
  first time". `04-structure.md` v6 — written after, `based_on: 03-design.md@9` — lists slice 6's
  files, outcome and verification with no prompt and no renderer file.** Later artifacts take
  precedence (`contract.md` rule 1), so this slice writes the bind and builds no prompt. A prompt
  would also need a decision the design does not make — how consent is carried through
  `sessionCreate` — so building one here would be a new decision, not an implementation. **Owed to
  `grove-design`**: either fold a consent prompt into a structure entry that owns it, or drop the
  clause from the two-way table. Recorded, not silently dropped.
- Slice 5's two blocked commands and its manual pass are still open; nothing here changes them.

### Tests first

- [x] Create `src/core/sandbox/service.test.ts` against a fake `container` script (the shape
      `container.test.ts` just established) that answers `network ls --format json` from a fixture
      and records every invocation: `ensureServiceReachable({ configFile, container, attempts: 1,
      firstDelayMs: 0, maxDelayMs: 0 })` against an empty config file runs `system start`, then
      `network ls --format json`, then leaves `JSON.parse(configFile)` equal to
      `{ hostname: '192.168.64.1' }`.
- [x] In the same file: a config that already carries a usable `hostname` spawns **nothing** at all
      (the log is empty) and leaves the file byte-identical — the bind is written once, not on
      every sandboxed session.
- [x] In the same file: every other key in the config file survives — write
      `{"port": 49561, "password": "s3cret"}` first, then assert the result is
      `{"port": 49561, "password": "s3cret", "hostname": "192.168.64.1"}`. The service writes its own
      `password` back into this file, so read-modify-write is the only safe form.
- [x] In the same file: a config file that does not exist is created with `hostname` in it, mode
      `0600`.
- [x] In the same file: `network ls` answering `[]` for the first two calls and a gateway on the
      third still succeeds, with three `network ls` calls logged.
- [x] In the same file: `network ls` answering a gateway of `0.0.0.0`, or of `127.0.0.1`, never
      writes anything and keeps retrying; past `attempts` it **rejects** (→ `no-sandbox` at the
      seam), and the config file is untouched.
- [x] In the same file: a `container` binary that is absent, and a `system start` that fails, both
      end in a retry that still reaches the write when discovery works — the failure of the
      idempotent `system start` must not be the refusal.
- [x] In the same file: `servicePassword(<registration file>)` returns its `password`, and returns
      `undefined` for a missing file, an unparseable one, and one with no `password`.
- [x] In the same file: no call grove makes writes to, or even opens, the registration file — the
      fake's log contains only `system start` and `network ls`.
- [x] Add to `src/core/sandbox/spec.test.ts`: `envFor('opencode', SESSION, { paths: PATHS,
      serverPassword: 'p' })` carries `XDG_STATE_HOME: '/home/u/.local/state'` beside the other two
      XDG pointers and `OPENCODE_SERVER_PASSWORD: 'p'`; `envFor('claude', …, { serverPassword: 'p' })`
      carries **neither**; `envFor('opencode', …)` with no `serverPassword` carries the pointer and
      no `OPENCODE_SERVER_PASSWORD` key at all.
- [x] In the same file: `PATHS` gains `opencodeRegistration: '/home/u/.local/state/opencode/service.json'`
      and `opencodeServiceConfig` moves to `'/home/u/.config/opencode/service.json'`; the existing
      `readOnlyPathsFor('opencode', …)` assertion that the state dir is carved out and the claude
      assertions stay exactly as they are.
- [x] Add to `src/core/sessionCreate.test.ts`'s `sessionCreate --sandboxed` block: a sandboxed
      **opencode** session is created (not refused) and its argv is a `container run` whose `-e`
      list carries `XDG_STATE_HOME=<dirname of paths().opencodeState>`; `sandboxed(core, { kind:
      'terminal' })` is still refused `no-sandbox`.

### Implement

- [x] Create `src/core/sandbox/service.ts` exporting two functions:
      `ensureServiceReachable(o: { configFile: string; container: string; attempts?: number;
      firstDelayMs?: number; maxDelayMs?: number }): Promise<void>` — return immediately when the
      config already names a usable hostname; otherwise run `container system start` (ignoring its
      exit status, since it is idempotent and may legitimately fail on a system already up), then
      poll `container network ls --format json` up to `attempts` times for
      `.status.ipv4Gateway` of the network whose `.configuration.name` is `default`, treating a
      missing/empty/wildcard (`0.0.0.0`, `*`)/loopback (`127.`) value as not-ready-yet, with a
      backoff of `firstDelayMs` doubling to `maxDelayMs` between attempts; on the first usable
      gateway, read-modify-write `hostname` into `configFile` and return; when the attempts run out,
      **throw**. Defaults, from the measurement: `attempts: 30`, `firstDelayMs: 250`,
      `maxDelayMs: 8000` — about 3½ minutes, which clears the measured 2m24s from login to
      `bridge100`. Writes `{ ...existing, hostname }` so the service's own `password` and `port`
      survive, creating the file mode `0600` when absent, and re-serialising as `JSON.stringify(x,
      null, 2) + '\n'`.
      `servicePassword(registrationFile: string): string | undefined` — the registration's
      `password`, or `undefined` for a missing, unparseable or passwordless file. Never throws.
- [x] `src/core/sandbox/spec.ts`: add `opencodeRegistration: string` to `AgentPaths` (next to
      `opencodeState`); give `envFor`'s options a `serverPassword?: string` and, for
      `kind === 'opencode'`, set `XDG_STATE_HOME = path.dirname(p.opencodeState)` alongside the two
      pointers it already sets and `OPENCODE_SERVER_PASSWORD = o.serverPassword` **only when a
      password was given**; give `specFor`'s options the same `serverPassword?` and thread it into
      `envFor`. Claude's branch is untouched.
- [x] `src/core/sandbox/launch.ts`: in `sandboxArgvFor`'s existing `try`, after
      `loginShellCredential`, add `const serverPassword = o.kind === 'opencode'
      ? await reachHostService(paths) : undefined` where `reachHostService` awaits
      `ensureServiceReachable({ configFile: paths.opencodeServiceConfig, container: sandbox.container })`
      then reads `servicePassword(paths.opencodeRegistration)`; pass `serverPassword` to `specFor`.
      Inside the `try` on purpose: every failure then collapses to `null` exactly as the other
      reasons do, which is `no-sandbox` on create and a downgraded resume with its note — never an
      unguarded pane (ADR 0033, ADR 0036).
- [x] `src/main/index.ts`: in the `agentPaths` literal, set
      `opencodeRegistration: serviceFilePath(process.env, home)` and change `opencodeServiceConfig`
      to `path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode',
      'service.json')`. Pass `serviceFilePath(process.env, home)` to `HttpOpenCode` at the
      `sources:` line, so the value it watches does not change.
- [x] `src/core/core.ts` `sessionCreate`: widen the guard from `kind === 'claude'` to
      `kind === 'claude' || kind === 'opencode'`, and update its comment to say that a terminal is
      still refused because it has no agent argv to wrap. The `no-repo` guard and `repoRefs`
      immediately above it are another agent's and are **not** touched.
- [x] `resources/sandbox/Dockerfile`: replace `opencode-ai@1.19.0` with `@opencode/cli@2.0.26` in
      the existing `npm install -g` line. Measured: `opencode-ai@2.x` does not exist on npm, the
      package was renamed and rescoped, and the 2.x tarball is a self-contained Bun binary needing
      glibc only, so no new apt package. Pinned **independently of the host's version** on purpose —
      the image is content-addressed on this file alone, and minor skew is tolerated on the
      `--server` path (it warns and proceeds).
- [x] `src/renderer/src/sandboxOptIn.ts`: `sandboxable` becomes `kind === 'claude' || kind ===
      'opencode'`, and its comment says why the terminal stays out. No other renderer file changes:
      the dialog reads `sandboxable`/`wantsSandbox` for its disabled state, its `aria-checked`, its
      class and its summary line, so all four follow.

### Verify

- [x] `npm test` — 935 passed / 83 files (was 911 / 81; +24). Slice 5's blocked `typecheck:web` cleared on its own: the other agent's `NewSessionDialog.tsx` landed, so both typechecks and the full build are clean for the first time since that commit.
- [x] `npm run typecheck`
- [x] `npm run build`
- [ ] **NOT RUN HERE — manual, and it needs a live app, a real controlling TTY and a reachable
      credential**: start an unsandboxed OpenCode session and note its status; start a sandboxed one
      and send it a prompt; confirm **both** show status; that
      `lsof -nP -iTCP -a -p $(pgrep -f 'opencode serve') -sTCP:LISTEN` shows the bridge address and
      not `*`; that the host's LAN address refuses; and that `stat` on the host's `service.json` is
      unchanged. Then **the cross-version check the spikes could not settle**: the image's
      `@opencode/cli@2.0.26` client against the host's v2 service over `--server`, and `opencode
      auth list` inside a sandboxed pane listing the host's provider. Left unticked on purpose.

## Slice 6, correction — grove tells the sandboxed OpenCode where the host service is

Planned after `03-design.md` v10 / `04-structure.md` v7 (approved 2026-10-12), against the
measured failure recorded in `06-implementation.md` on the same day. **This is slice 6's own
outcome, not a new one**: `04-structure.md` slice 6's verification has said "over `--server`"
since v6, and D6 has said "the client seam is the global `--server <url>` flag" since v9. The
first implementation read both as description and assumed the container would take its URL from
the registration file it can already read. That is the bug, and this section is the correction.

Context a fresh agent needs, inlined:

- **What actually happens in the container** (measured, transcript in `06-implementation.md`): the
  client reads the registration at `$XDG_STATE_HOME/opencode/service.json`, tries its `url`
  (`http://127.0.0.1:49374` — the container's own loopback), fails, calls `service.ensure`, starts
  a background server, reads the config grove mounts under `XDG_CONFIG_HOME` — the file grove just
  wrote `hostname: 192.168.64.1` into — and dies with `EADDRNOTAVAIL` **binding** an address it may
  only connect to. `Starting background server...` in the transcript is that fallback.
- **`--server` precedes any subcommand**, so it goes in immediately after the binary: grove's agent
  argv is `['opencode', '-s', <id>, …]`, and the sandboxed one is
  `['opencode', '--server', <url>, '-s', <id>, …]`.
- **The port comes from the registration's `url`**, not from the config — the config holds no port
  unless the human set one. Only the host part is replaced.
- `ensureServiceReachable` currently returns nothing; it has to return the gateway it wrote (or
  found) so the URL can be composed. That is `04-structure.md` v7's new signature.
- **No registration ⇒ `no-sandbox`** (human, 2026-10-12): no port to compose a URL from, and
  nothing to join. Refusing happens **before** the bind is written.

### Tests first

- [x] `src/core/sandbox/service.test.ts`: `ensureServiceReachable` resolves to the gateway it wrote,
      and to the one already in the config on the idempotent path.
- [x] In the same file: `serviceEndpoint({ registrationFile, gateway })` is
      `{ url: 'http://192.168.64.1:49374', password: 's3cret' }` for a registration whose `url` is
      `http://127.0.0.1:49374` — the host replaced, the port kept — and is `null` for a missing
      file, unparseable JSON, a `url` without a port, or one with no `password`.
- [x] `src/core/sessionCreate.test.ts`: a sandboxed **opencode** session's argv contains
      `opencode --server http://192.168.64.1:<port> -s <id>`, and does **not** contain
      `Starting background server` or a bare `opencode -s`; a sandboxed **claude** session's argv is
      unchanged and carries no `--server`.

### Implement

- [x] `src/core/sandbox/service.ts`: `ensureServiceReachable` returns `Promise<string>` — the
      gateway it discovered, whether it wrote it or found it already there; `servicePassword` is
      replaced by
      `serviceEndpoint(o: { registrationFile: string; gateway: string }): { url: string; password: string } | null`,
      which reads the registration once, keeps its port, and returns `null` rather than guessing.
- [x] `src/core/sandbox/launch.ts`: `reachHostService` returns that endpoint or `null`;
      `sandboxArgvFor` returns `null` when the kind is opencode and the endpoint is `null`, so a
      create is refused `no-sandbox` and a resume downgrades with its note; and the agent argv
      becomes `[argv[0], '--server', endpoint.url, ...argv.slice(1)]` for opencode only.

### Second correction, same day: grove's own OpenCode chrome did not cross into the VM

Found by hand, once the first correction had loaded and the session ran: tabs visible and the wrong
theme, which are one cause. `cliEnv` puts `OPENCODE_CLI_CONFIG_CONTENT` on the **pane**, and for a
sandboxed session the pane is `container run` — which forwards **only** what is explicitly `-e`'d.
Measured on the running container: its env held `OPENCODE_SERVER_PASSWORD`, the three `XDG_*`,
`GROVE_*`, and the image's own `NODE_VERSION`/`YARN_VERSION` — and nothing else. The override never
arrived, so OpenCode fell back to the user's `opencode.json`.

- [x] `src/shared/opencodeSession.ts` (NEW): `OPENCODE_CLI_CONFIG_CONTENT`, the one value both
      consumers read, with the reason it is shared — `cliEnv` and `envFor` writing it separately is
      exactly the drift `sandboxOptIn.ts` was built to prevent.
- [x] `src/core/core.ts`: `cliEnv` imports that constant; the literal and its `JSON.stringify` are
      gone. **The value is unchanged**, so `cliEnv.test.ts`'s exact-string assertion is the proof.
- [x] `src/core/sandbox/spec.ts`: `envFor` sets `OPENCODE_CLI_CONFIG_CONTENT` for
      `kind === 'opencode'` only — after `XDG_STATE_HOME`, so the XDG pointers stay adjacent.
- [x] Tests: `spec.test.ts` asserts it is present for opencode, absent for claude, and still says
      `tabs.mode: 'off'`; `sessionCreate.test.ts` asserts the `-e 'OPENCODE_CLI_CONFIG_CONTENT=…'`
      in the composed argv for opencode and its absence for claude.

### Verify

- [x] `npm test` — 940 passed / 83 files (was 938; +2).
- [x] `npm run typecheck`
- [x] `npm run build`
- [ ] **STILL NOT RUN HERE — manual.** The **host service restart is done** (human, 2026-10-12): the
      registration reads `http://192.168.64.1:49374` and `lsof` shows
      `TCP 192.168.64.1:49374 (LISTEN)` — the bridge address only, not `*`. A throwaway container
      confirmed it reachable over the bridge, answering `401`: reachable, and correctly demanding
      auth. What is still unverified by hand is the **rendered session itself** — that it comes up
      in grove's theme with no tabs, and answers a prompt. Unticked on purpose.

## Slice 7 — Failing loudly, and saying *which* thing failed

Planned against `03-design.md` v10 / `04-structure.md` v7. Slices 1–6 are done.

### What this slice has to fix, measured against the code as it is now

Every way of asking for a sandbox that cannot be had **already** returns `no-sandbox` and starts
nothing — slices 1, 2, 5 and 6 built that, and `sessionCreate.test.ts` asserts it. What is missing
is the half the slice's outcome actually names: *"a message saying what to do."* Two gaps:

- **One code for six failures.** `sandboxArgvFor` collapses everything to `null`, and `sessionCreate`
  returns the single string `no-sandbox`. So a missing bridge tells you to install the `container`
  CLI, and a missing OpenCode service tells you to run `claude setup-token` — both wrong, and both
  the kind of wrong that sends a human down a dead end.
- **Only the CLI has messages at all.** `MESSAGES` lives in `src/main/cliServer.ts`. The renderer
  gets `res.error` (`src/renderer/src/App.tsx:147`) and puts the **bare code** in the dialog — so
  from the GUI a failed sandbox says `no-sandbox`.

Context a fresh agent needs, inlined:

- `Result<T>` is `{ ok: true; data: T } | { ok: false; error: string }` (`src/shared/ipc.ts:3`) — the
  error is a free string, not a union, so a new code needs no type change anywhere.
- `failFrom(id, code)` is `fail(id, code, MESSAGES[code] ?? code)` (`src/main/cliServer.ts:37`) — an
  unmapped code degrades to itself rather than to nothing, which is what makes adding codes safe.
- `src/shared/` is imported by both `src/main/*` and `src/renderer/*` (`@shared/types`, `@shared/theme`),
  so one table can serve both surfaces. That is the whole reason this is a shared module.
- **`sessionResume` reads the same return value** (`core.ts:825`) and downgrades on it. A wider
  return shape must not break that: `{ refusal }` is truthy, so a bare truthiness check would
  silently skip the downgrade. Checked for `argv`, not for truth.
- The bridge retry is **3½ minutes** (`service.ts`: 30 attempts, 250 ms doubling to 8 s). A
  missing `container` must therefore be caught **before** the image build, not after it.

### Tests first

- [x] `src/core/sandbox/image.test.ts`: `sandboxAvailability(file)` is `{ ok: true }` against the
      fake `container` and `{ ok: false, refusal: 'no-container' }` for a path that is not there.
- [x] `src/core/sessionCreate.test.ts`: each refusal names itself — a `terminal` kind is
      `no-sandbox-kind`; a `container` that is not there is `no-sandbox-no-container` (asserted on a
      core whose sandbox path points at a missing binary, **not** a build failure); a `container`
      that fails its build is `no-sandbox-no-image`; no reachable credential is
      `no-sandbox-no-credential`; a sandboxed opencode with no registration is
      `no-sandbox-no-service`; and a fake whose `network ls` never names a gateway is
      `no-sandbox-no-bridge`. Each creates nothing.
- [x] In the same file: a resume that cannot sandbox still downgrades and still sets `sandboxNote`
      — the widened return shape must not turn a refusal into "it worked".
- [x] `src/main/cliServer.test.ts`: every `no-sandbox-*` code maps to a **distinct** message, and
      each names the command that fixes *that* failure — the credential one names
      `claude setup-token`, the bridge one names `container system start`, the service one names
      OpenCode, and none of the OpenCode ones mentions `claude setup-token`.
- [x] `src/main/cliServer.test.ts`: an unknown code still degrades to itself.
- [x] `src/shared/sandboxErrors.test.ts`: `errorMessage('no-sandbox-no-bridge')` is the bridge
      sentence, `errorMessage('nonsense')` is `'nonsense'`, and no sandbox message is empty.

### Implement

- [x] `src/core/sandbox/image.ts`: `export async function sandboxAvailability(container: string):
      Promise<{ ok: true } | { ok: false; refusal: 'no-container' }>` running `container --version`.
- [x] `src/core/sandbox/launch.ts`: `export type SandboxRefusal = 'unconfigured' | 'no-container' |
      'no-image' | 'no-credential' | 'no-bridge' | 'no-service'`, and `sandboxArgvFor` returns
      `Promise<{ argv: string[] } | { refusal: SandboxRefusal }>` instead of `string[] | null`:
      `unconfigured` when there is no sandbox to speak of, `no-container` from `sandboxAvailability`
      **before** `ensureImage`, `no-image` if the build rejects, `no-credential` from the probe,
      `no-bridge` if `ensureServiceReachable` throws, and `no-service` for an opencode session with
      no endpoint.
- [x] `src/core/core.ts`: `sessionCreate` returns `` `no-sandbox-${refusal}` `` (and `no-sandbox-kind`
      for a terminal, which never reaches the sandbox module); `sessionResume` tests the result for
      `argv` rather than for truth, so a refusal still downgrades.
- [x] `src/shared/sandboxErrors.ts` (NEW): `ERROR_MESSAGES` — the whole of `cliServer`'s table plus
      one entry per sandbox code, each naming its own fix — and `errorMessage(code)` falling back to
      the code, which is what `failFrom` already does.
- [x] `src/main/cliServer.ts`: delete its local `MESSAGES`, use `errorMessage`.
- [x] `src/renderer/src/App.tsx`: `startLaunch` returns `errorMessage(...)` rather than the bare
      code, so the dialog says the same thing the CLI does. **One line, and no other renderer file
      changes.**

### Verify

- [x] `npm test` — 949 passed / 84 files (was 941; +8).
- [x] `npm run typecheck`
- [x] `npm run build`
- [ ] **NOT RUN HERE — manual, needs a live app**: `grove new terminal --sandboxed` names the
      terminal and creates nothing; with `container` absent, the same names the CLI; with no
      credential in the shell, the Claude case names `claude setup-token`; and **from the GUI**, a
      failed sandboxed launch reads as a sentence in the dialog, not `no-sandbox`.
