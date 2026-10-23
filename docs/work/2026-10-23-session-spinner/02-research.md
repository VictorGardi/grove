---
feature: 2026-10-23-session-spinner
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

# Research: session spinner while a session starts

Paths under `src/`. Facts only.

## Data model and status

- `shared/types.ts:11-42` `Session`: `lastStatus: 'running' | 'gone'` (persisted), `startedAt`, `agentSessionId`, `kind: 'opencode'|'claude'|'copilot'|'terminal'`. Live, never saved: `status?: 'working'|'waiting'|'idle'`, `waitingFor?`.
- No `starting`/`creating` state exists anywhere. A fresh session is `lastStatus 'running'` with `status` undefined.
- `StateFile` is `schemaVersion: 9`; a new persisted field needs a decision on it.
- `renderer/src/sessionStatus.ts`: `ShownStatus = 'running'|'gone'|'working'|'waiting'|'idle'`; `shownStatus(s)` returns `'gone'` or `s.status ?? 'running'`; `statusTone`, `statusView`, `mostUrgent` (rolls children onto a collapsed parent's dot).
- `core/status.ts:251` `withStatus` sets `status` only if the source is connected, `agentSessionId` is set and (when `statusNeedsEvent`) a tracker exists. Claude and Copilot have `statusNeedsEvent = true` (`core/claude/source.ts:13`, `core/copilot/source.ts:29`): no status until the first spool record. OpenCode has it false (`core/opencode/client.ts:34`): status once the service is connected.
- Terminals: status from the pane's foreground command, polled every 1 s (`core/terminalActivity.ts:300-352`, `core/core.ts:527`); no status for up to ~1 s after creation.
- Sessions that exist after an app restart also have undefined status until their source connects, so `status === undefined` alone does not mean "freshly created".

## Create sequence (`core/core.ts:823-888` `commands.sessionCreate`)

1. `source.preflight()` (Copilot only).
2. Project resolve and git checks (CLI passes `cwd`; UI passes `projectId`).
3. Sandbox argv (may be slow) or `loginShellArgv`.
4. `await backend.create(...)`: `tmux new-session -d`; returns when the tmux session exists, not when the agent has drawn anything.
5. Only now `set('sessions', [...])` (l.879): **the card does not exist in the renderer until tmux has created the pane.**
6. `lockWorktree`, `refreshStatus()`, return `{ok, data: Session}`.
7. After return the agent boots inside tmux (login shell, then CLI). This gap is unobserved.
- UI worktree flow: `renderer/src/App.tsx:141` invokes `worktree:create` (slow `git worktree add`) then `session:create` (l.146), then `setFocused(id)`. Quick terminal: `App.tsx:98`. CLI: `main/cliServer.ts:70-111` calls the same `sessionCreate`.
- `sessionResume` (`core/core.ts:920-945`) uses the same `backend.create` path and has the same gap.

## Push to the renderer

- `shared/ipc.ts:401` `PushMap` `state:sessions: Session[]` (full array); `main/ipc.ts:112-123` coalesces per slice with `setImmediate`. Renderer: `stores/slices.ts:88` `api.on('state:sessions', setSessions)`; zustand `useSlices`. No optimistic entry, no pending list in the renderer.

## Sidebar and rail rendering

- Sidebar card `renderer/src/components/Sidebar.tsx` ~30-125 renders `<ListRow status={{...statusView(s), tone: statusTone(s)}}>` (l.86); collapsed parents show a `StatusDot` of `mostUrgent(kids)` (l.70).
- `components/ui/ListRow.tsx:33,39,48`: compact mode renders `StatusDot`; non-compact renders a `span.statusDot` with tone class (`ListRow.module.css`).
- Rail `components/SidebarRail.tsx` `Tile` (l.14-43): `Icon`, a `css.dot` with tone class `t-<tone>`, optional kids toggle. `SidebarRail.module.css:201-227`: 7px absolute dot, `.t-waiting` pulses via `@keyframes pulse`.
- `components/ui/Spinner.tsx` + `Spinner.module.css`: 12px ring, `currentColor`, `spin 0.7s linear infinite`, reduced-motion aware, `role="status"`. Not used by Sidebar, SidebarRail or ListRow.

## Commands and tests

- `npm test` (`vitest run`), `npm run typecheck`, `npm run build`, `npm run dev`.
- `vitest.config.ts`: node environment, `src/**/*.test.ts` only: no jsdom, no component tests. Renderer tests are pure-helper tests beside the source (`sessionStatus.test.ts`, `railBars.test.ts`). `noInlineStyles.test.ts` forbids inline styles. Adding a required field to `Session` means updating test factories.

## Open questions
