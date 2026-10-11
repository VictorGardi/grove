---
feature: 2026-10-08-agent-sandboxing
phase: plan
status: approved
version: 2
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
