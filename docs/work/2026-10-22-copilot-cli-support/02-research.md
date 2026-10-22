---
feature: 2026-10-22-copilot-cli-support
phase: research
status: approved
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: []
forced: []
repo_heads:
  - 786033d64346f7c0b985ecc9ff305f89cd1ab7b7
---

# Research: how agents plug into Grove today, and what is known about Copilot CLI

Facts only. Code facts come from two read-only code maps of the repo at the head above. Copilot CLI facts come from GitHub's public CLI reference page only and are unverified against a binary.

## Copilot CLI: what is known

- `copilot` is not installed on this machine. `gh copilot` is a wrapper that runs a `copilot` on PATH, or downloads one to `~/.local/share/gh/copilot`. Nothing was downloaded, so no flag below was checked against a binary.
- Documented flags (GitHub CLI reference): `--resume`, `--continue`, `--model`, `-p/--prompt`, `-i`, `--agent`, `--allow-tool`, `--allow-url`, `--allow-all` / `--yolo`, `--autopilot`, `--config-dir` (deprecated in favour of `COPILOT_HOME`), `--json`, `--output-format`.
- Auth: env vars checked in order `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`; `copilot login` stores a token in plain text under `~/.copilot/` (or `COPILOT_HOME`). User settings are `~/.copilot/settings.json`; repo settings `.github/copilot/settings.json`.
- Skills live in `.github/skills/`, custom agents in `.github/agents/`.
- Not documented on the page read: a way to pass a caller-chosen session id, session storage location and format, hooks (config location, event names, payloads), the exact meaning of `--resume` versus `--continue`, the install method.

## The agent seam (`src/core/agents/types.ts`)

- `AgentKind = Exclude<SessionKind,'terminal'>`; `SessionKind = 'opencode'|'claude'|'terminal'` at `src/shared/types.ts:4`.
- `AgentSource` (l.36-46): `kind`, `statusNeedsEvent`, `mintId(now)`, `argv(id, 'start'|'resume', {prompt,name,model})`, `start(onEvent)`, `snapshot(ids)`, `lastWrites(id)`, `forget(id)`, `stop()`.
- `AgentEvent` (l.12-21): `connected`, `disconnected`, `exec-started`, `exec-ended`, `pending` (permission or question, open/close), `child`, `busy`, `context`, `wrote(paths)`.
- Sources are registered in `src/main/index.ts:115`: `[new HttpOpenCode(...), new SpoolClaude({dir: spoolDir})]`.

## Claude: hooks writing a spool file, no server

- `src/core/claude/hooks.ts`: `hookSettings(spool)` builds a per-launch `--settings` JSON. Each hook appends `{"t":…,"e":<stdin json>}` to `<spool>/<id>.jsonl`. A statusLine command appends context data with `jq`, then chains the user's own statusLine.
- `claudeArgv` (l.53): start `claude --session-id <id>`, resume `claude --resume <latest SessionStart id or id>`, plus `--settings`, `--model`, `--name`, and the prompt as a positional.
- `spool.ts` tails the files (fs.watch plus 1 s poll). `normalise.ts` maps `UserPromptSubmit` to exec-started, `Stop`/`StopFailure`/idle `Notification` to exec-ended, `PermissionRequest` and `PreToolUse AskUserQuestion` to pending, `SubagentStart/Stop` to busy, `PostToolUse` on write tools to `wrote`, statusLine to `context`.
- `SpoolClaude` (`source.ts`): `statusNeedsEvent = true`, `mintId = randomUUID`, `connected` emitted immediately, `forget` deletes the spool file.

## OpenCode: shared HTTP service plus SSE

- `src/core/opencode/client.ts` `HttpOpenCode`: reads `$XDG_STATE_HOME/opencode/service.json` (url, password), Basic auth, SSE on `/api/event`, 45 s silence watchdog, snapshots from `/api/session/active` and `/message`. `statusNeedsEvent = false`.
- `argv` is `opencode -s <id> [--prompt p]` for start and resume; it ignores `model`. The model is passed as `OPENCODE_CONFIG_CONTENT` env (`src/shared/opencodeSession.ts`).
- `src/core/opencodeId.ts` mints OpenCode's own `ses_…` id format so `-s <id>` can be used before the session exists.
- OpenCode has an unreachable-service banner (`core.ts:571-595`, `sessionStatus.ts:66`).

## Core wiring (`src/core/core.ts`)

- Start (`sessionCreate`, ~l.819-890): `source.mintId`, `newSession` with `agentSessionId` and `launchModel`, `source.argv(id,'start',…)`, wrapped by the login-shell or sandbox wrapper, run in a tmux pane with `cliEnv`.
- Resume (~l.905-940): only for sessions whose last status is `gone`; `source.argv(id,'resume',{model: launchModel})`, new pane, resync.
- Status (`status.ts`): per-session tracker from events; precedence permission > question > working > waiting/done > idle. Notifications on transition are generic. Resync on reconnect uses `snapshot`.
- Generic already: `status.ts`, `autolink.ts` (needs only write paths from `wrote` events or `lastWrites`), `send.ts` (bracketed paste into the tmux pane), `cliOps.ts` (`waitTurn` blocks on session status), workflow/feature status (file based).
- No transcript reading exists in the app.
- `--model` is accepted for `claude` and `opencode` only (`src/cli/args.ts:79`, `src/main/cliServer.ts:84`), stored as `launchModel`.

## Every place that lists or switches on the kind

- `src/shared/types.ts:4` (+ comments l.20, l.28); `src/core/sessions.ts:3` `KIND_NAMES` (a `Record`, so the compiler flags it); `src/core/core.ts:201,211` (opencode env), `:589,594` (opencode banner), `:846` (`sandboxKind = claude||opencode`), `:1147`.
- `src/main/index.ts:53-63` `installSkill()` copies `resources/skills/grove` into `~/.claude/skills` and `$XDG_CONFIG_HOME/opencode/skills`; `:84-95` sandbox host paths; `:81` claude spool dir; `:115` sources.
- `src/cli/args.ts:20,27,39,79`; `src/main/cliServer.ts:50,84` (duplicate KINDS list).
- Renderer: `usualKind.ts:11,14`; `sandboxOptIn.ts:11`; `components/NewSessionDialog.tsx:15-18`; `components/LaunchPalette.tsx:22-25` (Digit1/2/3); `components/ui/Icon.tsx:5,32` (icon-name union plus an svg); `components/Sidebar.tsx:28`; `sessionStatus.ts:64-67`.
- Sandbox (`src/core/sandbox`): `spec.ts:55-57` binds, `:76` carve-outs, `:103-120` env, `:127` passEnv (claude `CLAUDE_CODE_OAUTH_TOKEN`,`ANTHROPIC_API_KEY`; opencode none); `auth.ts:15-33` (a non-claude kind falls into the opencode text); `launch.ts:34-44,85-95` (opencode only); `resources/sandbox/Dockerfile:20` bakes `claude-code` and `opencode` CLIs; `src/shared/sandboxErrors.ts:26,31`. These are if/else, so a third kind would silently take the opencode branch.
- Text: `resources/skills/grove/SKILL.md` (lines 3, 20, 23-24, 40-42, 121, 125, 128), `README.md` (lines 5, 14, 39-40, 57, 110), `CONTEXT.md:39-83`.
- Tests that mention kinds: `sessionCreate`, `sessions`, `sandbox/spec`, `status`, `cliEnv`, `usualKind`, `args`, `cliServer`, `stateStore`, `derive`, `sandboxOptIn`, `sessionStatus`. `src/core/testing/fakeAgentSource.ts` mints UUID unless kind is `opencode`.

## How OpenCode was added (precedent)

- `docs/work/2026-10-15-opencode-support` ran the auto flow with decisions on subagent model files, `--model` threading, skill wording and role resolution, and a first slice that verified CLI facts against the installed binary before building.
- The `grove-*` auto-flow skills currently name only `claude` and `opencode` as supported agents (`references/roles.md`, step 6 of role resolution).

## Commands

- `npm test` (vitest run), `npm run typecheck` (node + web tsc), `npm run build` (electron-vite build), `npm run dev`.

## Verified on a real install

Slice 1, 2026-10-22, by running the binary (`-p` non-interactive runs, `--help`, `copilot help <topic>`, a throwaway `COPILOT_HOME` in the scratchpad). Every line is marked **verified** or **unverified**.

- **Install and version** (verified): Homebrew cask `copilot-cli`, `/opt/homebrew/bin/copilot` -> `Caskroom/copilot-cli/1.0.102/copilot`; `copilot --version` prints `GitHub Copilot CLI 1.0.102.` Auto-update is on by default (`--no-auto-update`, `COPILOT_AUTO_UPDATE=false`).
- **Sign-in** (verified): `copilot login` (browser or device flow) stores a token in the system keychain, else plain text under `~/.copilot/`; `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` take precedence. A `gh` login worked with no `~/.copilot` at all. There is **no cheap read-only sign-in check** (no `copilot auth status`; the token is in the keychain). A bad token makes `copilot -p` print "To fix this, you can: ... use the '/login' command" and exit 0. Not tested: a truly signed-out machine (this one is signed in via `gh`). Consequence: Grove checks only that `copilot` is on the login shell's PATH; a signed-out Copilot shows its own login message in the pane (documented gap).
- **Session id** (verified): `--session-id <uuid>` sets the id of a new session (and resumes if it exists); the id appeared as the directory `$COPILOT_HOME/session-state/<uuid>/` and as `sessionId` in every hook payload. Grove can choose the id: D2 = A.
- **Resume** (verified): `--resume=<id>` resumed that conversation (asked what file it had made: "hello.txt"); `--continue` resumes the most recent; `--resume` alone opens a picker. Resume is by id, so D2 = A holds. Not tested: resume inside an interactive tmux pane after the pane died.
- **Status signals** (verified for `-p` runs): hooks fire for `sessionStart`, `userPromptSubmitted`, `preToolUse`, `permissionRequest`, `postToolUse`, `agentStop` (`stopReason: end_turn`, `transcriptPath`) and `sessionEnd` (`reason: complete`). Each hook command gets one JSON object on stdin with `sessionId`, `timestamp`, `cwd` and event fields (`toolName`, `toolArgs`, `toolResult.resultType`). Unverified: subagent start and stop events, an `ask_user` question signal, a permission request in an interactive pane, `errorOccurred`, `agentStop` after an aborted turn. `~/.copilot/session-state/<id>/events.jsonl` also records the session (session.start, model_change, hook.start/end, ...): a fallback source (D1 = B), not needed.
- **Hooks per launch** (verified): `--plugin-dir <dir>` with `plugin.json` (`{"name","version","hooks":"hooks.json"}`) and `hooks.json` (`{"version":1,"hooks":{"<event>":[{"type":"command","bash":"..."}]}}`) fired hooks on a run with no edit to the user's settings. Hooks can also come from `$COPILOT_HOME/settings.json` (`hooks` key, verified) and `.github/hooks/*.json` (documented, not run); the plugin route is the only one that needs neither. D1 = A is possible without touching `~/.copilot/settings.json`. `COPILOT_ALLOW_ALL=true` would also trust the folder and load its hooks; Grove does not set it.
- **Write paths** (verified in part): `postToolUse` carries `toolName` and `toolArgs`; the shell tool is `bash` with `toolArgs.command`. The name and argument shape of the file-edit tool is **unverified** (Slice 4 checks it).
- **Skills** (verified): user-level `~/.copilot/skills/<name>/SKILL.md` (honours `COPILOT_HOME`), also `~/.agents/skills`; project `.github/skills`, `.agents/skills`, `.claude/skills`; `copilot skill list/add/remove`. A skill placed in `$COPILOT_HOME/skills/foo` was listed under "Personal skills". D3 = A (`~/.copilot/skills`).
- **Custom agents** (partly verified): `--agent <name>` selects a custom agent (unknown name -> "No such agent: nonexist, available: "); project agents load from `.github/agents`. Whether an agent file carries a model, and whether it can be called as a subagent by role, is **unverified** (Slice 6). Settings also have `subagents.agents.<name>` with per-subagent `model` (documented in `copilot help config`, not run), a possible D4 route.
- **Model** (verified): `--model <model>`; `auto` lets Copilot pick (the default model in the session log was `auto`); an unknown name fails at startup with `Error: Model "<name>" from --model flag is not available.` (so a bad `--model` fails fast, exit non-zero); `COPILOT_MODEL` env also works. The valid names depend on the account and were not listed by any command tried.
- **Prompt** (verified): `-i <prompt>` starts interactive mode and runs the prompt; `-p <prompt>` is non-interactive and exits.
- **Permissions** (verified): `--allow-all` / `--yolo` / `--allow-all-tools`; not set by Grove.
- **Sandbox** (not used): Copilot has its own `sandbox` subcommand; out of scope (the brief's non-goal).
- **Unverified, to check where they matter**: behaviour of every flag above inside an interactive tmux pane (all runs were `-p`); the app (`grove new copilot` end to end in the running Electron app, below); a signed-out machine.

## Open questions
