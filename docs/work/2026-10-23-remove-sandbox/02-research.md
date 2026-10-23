---
feature: 2026-10-23-remove-sandbox
phase: research
status: approved
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at: 2026-10-23
based_on: []
forced: []
repo_heads:
  - 6d3c4c83eddc1b5b06202354e588854ce2e1dc74
---

# Research: where the sandbox feature lives today

Facts only. "Sandbox" here means the Apple `container` sandbox for agent sessions. The HTML `<iframe sandbox>` and CSP `sandbox allow-scripts` for the artifact viewer, and Claude Code's own `sandbox` key in `.claude/settings.local.json`, are different things and are listed under "Unrelated hits".

## Commands

`npm test` (vitest run), `npm run typecheck` (tsc node + web, `--noEmit`), `npm run build` (electron-vite build), `npm run dev`. No sandbox references in package.json scripts, electron.vite.config.ts, vitest.config.ts, scripts/ or tsconfig*.json. The electron-builder `asarUnpack` has `resources/**`, which covers `resources/sandbox/Dockerfile`. `tsconfig*.tsbuildinfo` are generated.

## Whole-file or whole-directory sandbox code

- `src/core/sandbox/`: 14 files (~1400 lines with tests). `argv.ts` (`container run` argv), `auth.ts` (login-shell credential probe), `container.ts` (`removeContainer`, `pruneContainers`), `image.ts` (availability, Dockerfile-hash image ref, build), `service.ts` (writes the bridge address into the host opencode `service.json`; reads registration), `spec.ts` (mounts at host-identical paths, env, `AgentPaths`; calls `opencodeCliConfig` and `opencodeModelEnv`), `launch.ts` (`sandboxArgvFor`, `SandboxRefusal`, `LOST_SANDBOX`), plus one `*.test.ts` per file (7).
- `resources/sandbox/Dockerfile` (24 lines, includes the grove CLI bundle).
- Renderer: `sandboxOptIn.ts` + test, `components/SandboxToggle.tsx` + css (used only by LaunchPalette), `components/ui/SandboxMark.tsx` + css (used only by SessionMeta), `components/ui/Switch.tsx` + css (imported only by SandboxToggle and NewSessionDialog; its comment says it is shared by the two places a sandbox can be asked for; `tokens.css:20` defines `--switch-track` for it).

## Sandbox code interleaved with live code

- `src/core/core.ts` (~39 hits): imports (lines 35-38); `CoreOptions.sessionEnv?: {socketPath; binDir} & Partial<AgentPaths>` (line 58, the `socketPath`/`binDir` part is also used for GROVE_SOCKET, PATH and `cliEnv`); `CoreOptions.sandbox` (59); `sandboxed?` in the sessionCreate type (94); `sandboxDeps()` and `dropContainer()` (215-220); persist-strip destructure of `sandboxNote` (234); sessionCreate (~823-870) computes `sandboxKind`, returns `no-sandbox-kind`, calls `sandboxArgvFor`, returns `no-sandbox-<refusal>`, else-branch is the plain `loginShellArgv`; `dropContainer` in kill/remove (~894, ~906); resume (~915-941) uses `session.sandboxed ? sandboxArgvFor : null` and downgrades to `sandboxed:false, sandboxNote: LOST_SANDBOX`; startup/crash `pruneContainers` (~1138-1141); comment at 209-210. `cliEnv` stays and uses `opencodeCliConfig`/`opencodeModelEnv` (lines 201, 211). `gitCommonDir` is imported by core.ts only for `sandboxDeps`; it is still defined in `./git`.
- `src/core/sessions.ts`: `sandboxed?` param (10) and field `sandboxed: o.sandboxed ?? false` (24).
- `src/shared/types.ts`: `Session.sandboxed: boolean` (24), `Session.sandboxNote?: string` (39, never persisted).
- `src/core/agents/types.ts` 35-37: `SandboxKind`, `isSandboxKind` (used only by core.ts and sandbox/launch.ts). Copilot is never sandboxable (`isSandboxKind` false). No other agent-specific sandbox code in `src/core/agents/*`; opencode-specific parts are in sandbox/service.ts, launch.ts (`--server <url>`) and spec.ts (server password env). `src/core/claude/*` has only JSONL fixtures that contain the word.
- `src/core/store/stateStore.ts`: migration `v8ToV9` (42-46) adds `sandboxed: false`; schemaVersion is 9, chain 1..8 → 9.
- `src/shared/ipc.ts:20` `sandboxed?` on `session:create`. `src/shared/cli.ts:9` `sandboxed?` on `sessions.create`.
- `src/cli/args.ts`: `Command.sandboxed` (7), help line (29), parseArgs option (67), `sandboxed: !!values.sandboxed` (83). `src/cli/index.ts:49` passes it. `src/main/cliServer.ts:99` `sandboxed: params.sandboxed === true`.
- `src/shared/sandboxErrors.ts` (42 lines): the general session error-code → sentence table (`errorMessage`, `ERROR_MESSAGES`: not-found, no-feature, no-copilot, worktree-failed, ...) plus a `no-sandbox-*` block (`no-sandbox-kind`, `-unconfigured`, `-no-container`, `-no-image`, `-no-bridge`, `-no-service`, `-no-credential`, and `no-sandbox`). Importers: `src/main/cliServer.ts`, `src/main/cliServer.test.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/ParentPicker.tsx`. Test: `src/shared/sandboxErrors.test.ts`.
- `src/main/index.ts`: imports `AgentPaths` (8); builds `agentPaths` (~82-100: claudeHome, claudeJson, opencode*, gitconfig, spoolDir, socketPath, cliBundle); passes `sessionEnv: { binDir, ...agentPaths }` (~101) and `sandbox: {container, dockerfile}` (~103). `serviceFilePath`, `spoolDir`, `copilotDir`, `socketPath`, `cliBundle`, `home` are used elsewhere in the file.
- `src/shared/opencodeSession.ts`: only comments (6-8, 22-24) mention the sandbox; the functions are live host code.
- Renderer: `App.tsx` (29 import, 45-48 `quickSandbox` in-memory state, 152 payload, 157 comment, 283 props to LaunchPalette); `LaunchPalette.tsx` (props `sandboxed`/`onSandbox`, `isolated`, payload, ⌥S key handler, toggle + `<kbd>⌥S</kbd>`, summary text "sandboxed — files only, network is open" / "on your host") and `.sandbox` in its css; `NewSessionDialog.tsx` (launch type `sandboxed` also consumed by `App.startLaunch`, state, payload, `isolation` string, "Isolation" row with Switch "Run in a sandbox" and hints; css `.isolation`, `.off`, `.isolationText`, `.isolationTitle`, `.hint`); `SessionMeta.tsx` (renders `SandboxMark` in the session header and grid cards); `sessionStatus.ts` 53-61 `sandboxView`; `components/ui/Modal.tsx` 21-24 (comment and `[role="switch"]` in `closest('button, [role="switch"]')`; Modal is used by many dialogs).
- Comment-only: `src/main/menu.ts:25`, `paletteItems.test.ts:43`.

## Tests

- Deleted with the feature: `src/core/sandbox/*.test.ts` (7), `src/renderer/src/sandboxOptIn.test.ts`.
- Need edits: `src/core/sessionCreate.test.ts` (131 hits, the largest), `src/main/cliServer.test.ts` (~98-123), `src/cli/args.test.ts` (13, 28-31), `src/core/store/stateStore.test.ts` (~213-226), `src/shared/sandboxErrors.test.ts` (asserts `no-sandbox-*` codes), `sessionStatus.test.ts` (`describe('sandboxView')` 70-92 and fixture), and Session fixtures with `sandboxed: false` in navigation, railBars, sessionList, tree, contextGauge tests.

## Persisted data and leftovers on user machines

- State file `userData/state.json`, schemaVersion 9, sessions carry `sandboxed` true/false. `readVersioned` (`src/core/store/jsonFile.ts`) runs the migration chain and returns the object as is when the version equals the current one; unknown fields are not stripped and are rewritten on save (core.ts ~234 strips only transient fields). A file whose version is neither current nor reachable by migration is renamed `state.json.bad-<ts>` and replaced by empty state; older builds cannot read a newer-version file.
- Running containers named after `tmuxName`, built `container` images (tag = Dockerfile hash), and the bridge-address edit in `~/.config/opencode/service.json` may exist on machines. The only cleanup today is the startup `pruneContainers`.
- Error codes visible to clients: `no-sandbox-kind`, `no-sandbox-<unconfigured|no-container|no-image|no-credential|no-bridge|no-service>`, `no-sandbox`. Socket param: `sessions.create {sandboxed}`; CLI flag `--sandboxed`.

## Docs

- `README.md`: lines 14, 22 ("Sandboxed sessions" bullet), 40 (`grove new opencode --sandboxed ...`, Copilot has no sandbox), 59 ("Optional: Apple container"), 75.
- `CONTEXT.md`: 42, 44 (launch dialog and session creation mention sandbox), 53-62 term **Sandboxed session**, 64 **Sandbox spec**, 70 (network/LAN and sandboxed OpenCode service address). Also the term **Container bridge**. Line 165 is the iframe sandbox (unrelated). `AGENTS.md`: none.
- ADRs (`docs/adr/`, next free number 0045): 0033 sessions persist a sandboxed flag (state v8), 0034 agent sessions run in an Apple container sandbox, 0035 mounts at host-identical paths, 0036 filesystem-only isolation, 0038 sandboxed worktree sessions refused (already Superseded by 0035), 0039 sandbox mounts grove's own CLI, 0040 sandboxed sessions authenticate through the agent's own channel. Mentions only: 0037 ("Multi-repo sandboxing makes it load-bearing"), 0044 ("No sandbox").
- ADR convention: no ADR README; template `0000-template.md` has Status, Context, Decision, Consequences. ADRs are never deleted; supersession is written in the status line (`Superseded by [NNNN](./NNNN-....md)`) with a "Superseded." paragraph appended; amendments use dated `## Amendment` sections.
- `docs/work/2026-10-08-agent-sandboxing/` is the original feature folder (historical record). About 25 other `docs/work` folders mention the word in passing.
- `.grove/tasks`: backlog T-196 "OS-level sandbox for agent execution on macOS", backlog and archive T-191 (tmux in sandbox-exec), archive T-068. Others: `spikes/tmux-opencode/q1-attach-cycle.sh`, `spikes/electron/README.md`, `research_notes/macOS Seatbelt versus Apple containers/` (4 files), `reports/macOS Seatbelt versus Apple containers.md`, `reports/sandbox-indicator-mockups.html`, `reports/session-launch-mockups.html`, `reports/where-list-shapes.html`, `reports/branch-display-options.html`.

## Unrelated hits (not the feature)

`src/renderer/src/components/ArtifactViewer.tsx:12,105` (`<iframe sandbox="allow-scripts">`), `src/main/artifacts.ts:11-12` (CSP sandbox), `CONTEXT.md:165`, ADRs 0007, 0021, 0022, 0026, `.claude/settings.local.json` `sandbox` key, `resources/viewer/comments.js` (DOM "container"), `src/core/discovery/watcher.test.ts:9`, JSONL fixtures under `src/core/claude/fixtures/`.

## Open questions
