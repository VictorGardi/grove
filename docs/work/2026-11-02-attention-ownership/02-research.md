---
feature: 2026-11-02-attention-ownership
phase: research
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
repo_heads:
  - 57f7f1dd53264ab4d6a8fddea886a749bd79a1b3
---

# Research: notification tiers

Facts only, from two read-only researchers. Paths are under the repo root.

## Run the project

- Test: `npm test` (vitest run). Typecheck: `npm run typecheck` (`typecheck:node` + `typecheck:web`, `tsc --noEmit`). Build: `npm run build`. Dev: `npm run dev`.
- Tests are colocated `*.test.ts`, vitest `describe/it/expect`, imports via the `@shared` alias, `NOW` from `./testing/setup`, pure reducers tested with plain inputs and "input not mutated" assertions.

## Status layer

- `src/shared/types.ts:32-33`: `Session.status?: 'working'|'waiting'|'idle'` and `waitingFor?: 'permission'|'question'|'done'`, live only, never saved (`core.ts:251` strips them before save). `:38` `startup?: {phase:'starting'}|{phase:'failed',reason}` covers pane creation failure only. `:41` `parentId`, one level deep (a parent never has a parent). `:28` `seenAt`, persisted.
- `src/core/agents/types.ts`: `AgentEvent` = connected | disconnected | exec-started | exec-ended{at} (comment says "succeeded | failed | interrupted", but failure info is dropped) | pending | child | busy | context | wrote. No failure or error field anywhere.
- `src/core/status.ts`: `Tracker{running,pending,idleAt,children,busy,context}`; `apply()` (:17) folds events per root session; `statusOf` (:80) precedence permission > question > working > waiting/done (idleAt newer than seenAt) > idle; `withStatus` (:92). The Tracker has no failed or error field.
- `src/core/core.ts`: `withAllStatus` :539, `stampStatusAt` :530, `refreshStatus` :571 (calls `markSeen` when the on-screen session changes), `notifyTransitions` :589-600.
- Renderer receives `Session[]` through the `slice` IPC (`src/main/ipc.ts:115`).

### How a turn ends, per agent kind

- **Claude** (`src/core/claude/normalise.ts` ~:128): `Stop` and `StopFailure` are handled identically (main scope, close pending, `exec-ended`). `StopFailure` is installed (`hooks.ts:14`) but its payload is not read. An Esc interrupt arrives as `Notification idle_prompt` and ends a running turn; there is no interrupt hook. `PostToolUseFailure` only closes pending.
- **Copilot** (`src/core/copilot/normalise.ts` ~:107-172): `agentStop` and `assistant.turn_end` end the turn; `abort` and `session.shutdown` (from `events.jsonl` via `events.ts:5`) end it only if running and not stale; `postToolUseFailure` only closes pending. No error event is mapped.
- **OpenCode** (`src/core/opencode/normalise.ts:20,42`): `session.execution.succeeded | failed | interrupted` all map to the same `exec-ended`; the outcome is discarded. `session.tool.failed` (:105) and `session.step.failed` (:168) exist in the file. No `session.error` handling found.
- **Terminal** (`src/core/terminalActivity.ts`): foreground command via tmux; shell = idle, other = working; a command that ran at least 3000 ms (`FINISH_MIN_MS`) and ended off screen is waiting/done. No exit code is read.

### Where a new status value would land

- `src/renderer/src/sessionStatus.ts`: `ShownStatus` already includes `'failed'` (:4), but only for `startup.phase === 'failed'` (:9, :16); `statusView` :14, `statusTone` :22, `URGENCY` :30 (failed first), `mostUrgent` :31, `trackWaiting` :39, `longestWaiting` :56.
- `components/ui/StatusDot.tsx:5,9` already has a `failed` tone.
- Branches with no `failed` case: `Sidebar.tsx:67`, `family.ts:19-21` (RANK), `tree.ts:46-51` (columns), `paletteItems.ts:62`, `SessionMeta.tsx:83`, `ChildrenPopover.tsx`, `Board.tsx`, `SessionsBoard.tsx`, `sessionList.ts` (groupBy status, `types.ts:116-117`), `FeaturePage.tsx:85`.
- `src/main`: `index.ts:117-121` (BODY map keyed by waitingFor, returns if `!s.waitingFor`), `sound.ts:8-21` (SOUNDS keyed by waitingFor), `cliServer.ts:25-26`; `src/shared/cli.ts:22,44-45` (wait result type `'idle'|'waiting'|'gone'`).
- `src/core`: `cliOps.ts:102-106` (wait logic), `sessions.ts:47`, `statusAt.ts:5-20` (`statusKey = status:waitingFor`).

## Notification layer

- `core.ts:584-599`: `refreshStatus()` calls `notifyTransitions(kind, primed, onScreen)` per connected source (terminal with primed=true). It loops sessions with `lastStatus 'running'`; if status is not `waiting` or has no `waitingFor` it deletes the `waitKey` entry; if `waitKey` equals `waitingFor` it skips; otherwise it records it and, if `primed && s.id !== onScreen`, calls every `notify` listener with the `Session` only (no parent or sibling context).
- `primed` is `SourceState.primed` (`core.ts:71`), set true at 659 and 671 after the first re-sync.
- `onScreenId()` (`core.ts:536`) = `windowFocused ? slices.ui.focusedSessionId : null`. `windowFocused` is set by `core.setWindowFocused` (`:1290`), called from `src/main/index.ts:157-165` on `ready-to-show`, `focus` and `blur`. No `powerMonitor` or system-idle use exists in `src/main`. Only one focused session is considered (no grid or multi-pane visibility).
- `src/main/index.ts:117-137` is the only `notify` subscriber: plays a sound if darwin and `core.soundsOn()`, then, if `Notification.isSupported()` and `s.waitingFor`, shows an Electron `Notification` (title `s.label`, body from BODY). Click raises the window and calls `uiSet({focusedSessionId})`.
- `src/main/sound.ts`: Glass for permission and question, Funk for done; debounced `SOUND_GAP_MS=1000`; darwin only; untested (no `sound.test.ts`).
- Config: `ConfigFile` (`types.ts:178`) `{schemaVersion:1; projects; workflow?; sounds?}` at `~/.config/grove/config.json` (`main/index.ts:87`), read once at start (`core/store/configStore.ts`, `core.ts:1227-1229`), rewritten only when `projects` changes (`core.ts:241-247`); a new config field must be added to that write or it is dropped. No settings UI exists; `sounds` is hand-edited JSON.

## Persistence and IPC for a new per-session field

- Persisted `Session` fields include `seenAt`, `lastFocusedAt`, `lastContext`, `parentId`, `launchModel`. `core.ts` `set()` (:236) filters unsaved sessions and writes the state file; `StateFile` is schemaVersion 10 (`types.ts:179`); migrations in `src/core/store/stateStore.ts:56-58` (`readVersioned`, map v1..v9). Loading back-fills `seenAt: x.seenAt ?? null`, so an optional field needs no migration.
- Setter pattern (`session:setParent`): `Commands` interface `core.ts:101`; implementation `core.ts:1062` (pure `withParent` in `src/shared/sessionGroups.ts:31` then `set('sessions', ...)`); channel map `src/shared/ipc.ts:26`; handler `src/main/ipc.ts:52`; the preload is generic; renderer calls at `Sidebar.tsx:662-663` and `ParentPicker.tsx:22`. Simpler analogues: `sessionRename` (`core.ts:1035`), `sessionLink`, `sessionWorkflowStatus` (`findSession` + `replaceSession`).
- The CLI view is built in `src/main/cliServer.ts:~20-35` (`parent: s.parentId ?? null`, waitingFor, etc.).

## Parent and child

- `parentId` is persisted; helpers in `src/shared/sessionGroups.ts` (`leaderOf` 13, `hasChildren` 16, `resolveParent`/`withParent` 20-40, `orphanChildren` 44, `canParent` 50). Any session without a parent and without children can be a parent, of any kind including terminals.
- Core looks parents up by array (`slices.sessions.find(x => x.id === s.parentId)`); no dedicated helper. Renderer helper: `familyOf` in `src/renderer/src/family.ts:43`.
- Grove-level children are separate sessions, distinct from agent-internal subagents (`status.ts` `child` events fold into the root tracker).
- A parent blocked in `grove wait` is a running tool call in its own turn, so `statusOf` shows it `working`. Nothing marks it as waiting on a child. `grove wait` exit codes: 0 done, 4 needs you, 5 gone, 124 timeout.
- Sidebar: `Sidebar.tsx:63-90` parent rows show a children count and, when collapsed, a `StatusDot` of `mostUrgent(kids.list)`; also `ChildrenPopover.tsx` and family jump (`familyJumpTarget`, ⌘⇧J).

## Tests nearest the change

- `src/core/status.test.ts`, `statusAt.test.ts`, `terminalActivity.test.ts`; `claude/normalise.test.ts` (fixtures `claude/fixtures/capture-*.jsonl`), `claude/hooks.test.ts`, `claude/source.test.ts`; `copilot/{normalise,events,source}.test.ts`; `opencode/{normalise,client}.test.ts`; `cliOps.test.ts`; `sessions.test.ts`; `src/renderer/src/sessionStatus.test.ts`; `src/shared/sessionGroups.test.ts`; `cliServer.test.ts`; `stateStore.test.ts`; `configStore.test.ts`.
- `sessions.test.ts` `describe('core seen and notify')` (:608) uses `setupCore()` with a fake OpenCode source and helpers `flush`, `snap`, `connect`, `find`; it drives `core.setWindowFocused(true)` and `commands.uiSet({focusedSessionId})` and records `core.on('notify')`. `describe('terminal notify')` at :818; `features.test.ts:384` also listens to `notify`.

## Open questions
