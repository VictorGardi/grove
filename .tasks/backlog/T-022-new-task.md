---
id: T-022
title: plan/execute agents survive app restarts
status: backlog
created: '2026-04-04'
planSessionId: ses_2a6129df2ffenKOTkiWVtjS6Da
planSessionAgent: opencode
planModel: github-copilot/claude-sonnet-4.6
useWorktree: false
---

## Problem

When a plan or execute agent (opencode/copilot CLI) is running in a task's chat panel and the user quits the app, the agent process is killed. On restart the conversation is gone — the user must start over.

What the user wants:
- The agent continues running after app quit
- On restart, reconnect to the running agent and see its ongoing output
- If the agent already finished, resume with its session context on the next Send

Terminal sessions (xterm.js panel) are **out of scope** for this task.

## Root Cause

`PlanManager.run()` spawns the agent as a direct child process of the Electron main process. When Electron exits, all its children are killed. The agent has no independent lifecycle.

## Solution: tmux Supervisor + Named Pipe (FIFO)

Use tmux as an external process supervisor. The agent runs inside a detached tmux session that outlives the app. Output is captured via a named pipe (FIFO) that the main process reads with readline — the same JSON parsing logic as today.

### Canonical Session ID

One identifier is used consistently everywhere:

```
grove-plan-<6-char-sha256-of-workspacePath>-<taskId>
```

Example: `grove-plan-a3f9c1-T-007`

This string is used as:
- The tmux session name
- The FIFO filename: `~/.grove/pipes/grove-plan-a3f9c1-T-007.out`
- Stored in task frontmatter as `planTmuxSession` (plan mode) / `execTmuxSession` (execute mode)

The agent's internal session ID (`planSessionId` / `execSessionId`) is separate — it is passed to opencode via `--session` to give the agent its conversation context.

### Startup Sequence (critical ordering)

Race condition avoided by strict ordering:

1. Create FIFO: `mkfifo ~/.grove/pipes/<tmuxSession>.out`
2. Open FIFO for reading in Node.js (creates a readline on the file descriptor)
3. **Only then** send the command to tmux: `tmux send-keys -t <tmuxSession> "opencode run ... > <fifo>" Enter`

Steps 1 and 2 must complete before step 3. A FIFO blocks on write until a reader is attached — if the command runs before the reader is ready, tmux will hang.

### Session Creation (new agent run)

```
# 1. Create tmux session (idempotent via -A)
tmux new-session -A -d -s grove-plan-<hash>-<taskId> -c <cwd>

# 2. Create output FIFO
mkfifo ~/.grove/pipes/grove-plan-<hash>-<taskId>.out

# 3. Open FIFO reader in Node.js (readline on fs.createReadStream)

# 4. Send agent command to tmux, redirecting stdout to FIFO
tmux send-keys -t grove-plan-<hash>-<taskId> \
  "opencode run --format json --session <agentSessionId> -- '<message>' > ~/.grove/pipes/grove-plan-<hash>-<taskId>.out" Enter
```

Node's readline reads each JSON line from the FIFO and feeds it to `PlanManager`'s existing `parseLine()` and `onChunkCb`. Chunks flow to the renderer via `plan:chunk` IPC — same as today.

### On App Quit

Instead of calling `planManager.cancelAll()` (which SIGTERMs agents):
- Close all FIFO read streams (release file descriptors)
- Do **not** run `tmux kill-session` — tmux sessions survive
- The agent keeps running in the background

### On App Restart / Reconnect

For each task in the store that has a `planTmuxSession` in frontmatter:

1. Check: `tmux has-session -t <tmuxSession>` (exec'd as a one-shot shell command)
2. **If alive**: Create a new FIFO reader and start receiving chunks into the UI. The user sees the agent's ongoing or remaining output. When done, the next Send resumes normally with `--session <agentSessionId>`.
3. **If dead** (agent finished or crashed while app was closed): No reconnect needed. Session is in paused state. Next Send starts a new opencode invocation with `--session <agentSessionId>` — agent picks up from its stored context. Delete the stale FIFO if present.

### "Send" After Restart

- If tmux session **alive**: reconnect reader, watch it finish. No new message injected — opencode/copilot are single-shot per invocation. Next message goes in a new invocation after the current one finishes.
- If tmux session **dead**: start new agent invocation normally with `--session <agentSessionId>`.

### Message History Gap

Chat message history is in-memory only. On restart the chat shows empty. The agent has its internal context (via `--session`) but the user sees a blank slate. This is acceptable for v1.

A status banner in `PlanChat` shows the session state:
- "Agent running — reconnected" (tmux alive, currently streaming)
- "Session paused — send a message to resume" (tmux dead, sessionId exists)

### PlanManager Refactor

Current `PlanManager` tightly couples spawning (`child_process.spawn`) with parsing (`parseLine`, `onChunkCb`). These must be separated:

**New `PlanRunner` interface:**
```typescript
interface PlanRunner {
  start(opts: RunOpts): void;   // start agent, begins feeding chunks
  cancel(): void;               // stop and clean up
  detach(): void;               // release resources without killing agent (app quit path)
}
```

**Two implementations:**
- `SpawnPlanRunner` — current behavior (direct spawn, no persistence). Used when tmux is unavailable.
- `TmuxPlanRunner` — new behavior (tmux + FIFO). Used when tmux is available.

`PlanManager` becomes a thin coordinator: picks the right runner, holds `parseLine` and `onChunkCb` as shared utilities, delegates `start`/`cancel`/`detach` to the active runner.

### `TmuxSupervisor` module (`src/main/tmuxSupervisor.ts`)

Encapsulates all tmux + FIFO logic:

```typescript
class TmuxSupervisor {
  isTmuxAvailable(): boolean
  start(tmuxSession, agentSessionId, cwd, agent, model, message, onChunk): void
  reconnect(tmuxSession, agentSessionId, onChunk): Promise<{ alive: boolean }>
  kill(tmuxSession): Promise<void>   // kill tmux session + delete FIFO
  detachAll(): void                  // close all FIFO readers, leave tmux alive
  cleanupOrphanedFifos(): void       // called on startup
}
```

FIFO directory: `~/.grove/pipes/` (created on first use, using `os.homedir()`).

### FIFO Buffer Overflow

Named pipes on macOS/Linux have a ~64 KB kernel buffer. If the Node.js reader is slow, the writer (opencode) blocks. This is acceptable — the agent simply pauses output momentarily until the buffer drains. No data is lost and no special handling is needed for typical agent output volumes.

### Edge Cases

| Scenario | Behaviour |
|---|---|
| tmux not installed | `isTmuxAvailable()` returns false on startup. Fall back to `SpawnPlanRunner` (agents die on quit — same as today). Persistent warning banner in UI when starting an agent. |
| FIFO dir creation fails | Log error, fall back to `SpawnPlanRunner` for this session. |
| Agent crashes inside tmux | tmux session exits. FIFO write end closes. Node readline `close` fires. `onChunk` receives `done` chunk. UI shows agent finished. |
| User manually kills tmux session from terminal | Same as crash path above. |
| tmux itself crashes | Extremely rare. Same as crash path. |
| User presses Ctrl+C in tmux pane | Agent exits. Same as crash path. |
| App restarts while agent still writing to FIFO | New FIFO reader opened before tmux re-runs the command (via `tmux -A` reattach). Continuity maintained. |
| Stale FIFO from prior crash | Detected on startup via `cleanupOrphanedFifos()` — any FIFO with no matching live tmux session is deleted. |
| Two workspaces with same task ID | Distinct tmux session names via workspace hash prefix (`grove-plan-<hash>-<taskId>`). No collision. |
| User clicks × or "New session" | `kill(tmuxSession)` — sends `tmux kill-session`, deletes FIFO, clears `planTmuxSession` from frontmatter. |
| Task moved to Done | Same as above — kill tmux session before worktree teardown. |

### Files Affected

| File | Change |
|---|---|
| `src/main/tmuxSupervisor.ts` | **New** — `TmuxSupervisor` class: start, reconnect, kill, detachAll, cleanupOrphanedFifos, isTmuxAvailable |
| `src/main/planManager.ts` | Refactor: extract `PlanRunner` interface; `SpawnPlanRunner` (existing logic); `TmuxPlanRunner` delegates to `TmuxSupervisor`; `PlanManager` picks runner based on tmux availability |
| `src/main/ipc/plan.ts` | Add `plan:reconnect`, `plan:tmux-check`, `plan:is-tmux-available` IPC handlers; update `plan:send` to use new runner path |
| `src/main/ipc/index.ts` | Replace `cancelAllPlans()` with `detachAllPlans()` (calls `planManager.detachAll()`); keep `cancelAllPlans()` for "New session" / task-done paths |
| `src/main/index.ts` | `before-quit` calls `detachAllPlans()` instead of `cancelAllPlans()` |
| `src/main/tasks.ts` | Add `planTmuxSession` / `execTmuxSession` fields to task frontmatter read/write |
| `src/shared/types.ts` | Add `planTmuxSession`, `execTmuxSession` to `TaskInfo` type |
| `src/preload/index.ts` | Expose `plan.reconnect`, `plan.tmuxCheck`, `plan.isTmuxAvailable` |
| `src/preload/index.d.ts` | TypeScript types for new API surface |
| `src/renderer/src/components/TaskDetail/PlanChat.tsx` | Check session state on mount; show "running/paused" banner; reconnect logic on mount when tmux session alive |
| `src/renderer/src/stores/usePlanStore.ts` | Add `sessionStatus: 'idle' | 'running' | 'paused' | 'reconnecting'` to session state |

## Definition of Done

- [ ] Running an agent, quitting app (`Cmd+Q`), reopening — `tmux ls` shows session alive; reopening the task reconnects and streams remaining output to the chat UI.
- [ ] If the agent finishes while the app is closed, reopening the task shows "Session paused" banner and the next Send resumes with `--session <agentSessionId>`.
- [ ] `tmux ls` after app quit shows `grove-plan-*` sessions alive for all tasks that had agents running.
- [ ] On app restart, FIFO reader is opened before tmux command is re-sent (no hanging — verify by running under `strace` or adding startup timing logs).
- [ ] Canonical session ID `grove-plan-<hash>-<taskId>` is used consistently as the tmux session name, FIFO filename, and `planTmuxSession` frontmatter field.
- [ ] `planTmuxSession` field is written to task frontmatter when a session starts and cleared when session is killed.
- [ ] "New session" button kills the tmux session. `tmux ls` confirms no session for that task after click.
- [ ] Moving a task to Done kills the tmux session. `tmux ls` confirms cleanup.
- [ ] With tmux not installed: app starts without crashing, persistent warning banner shown when user tries to start an agent, agents still work (via spawn fallback) but don't survive quit.
- [ ] FIFO directory creation failure: falls back to `SpawnPlanRunner` for that session, logs error, no crash.
- [ ] Orphaned FIFOs from prior crashes are cleaned up on app startup.
- [ ] Two workspaces with task `T-001` each running agents produce distinct tmux session names and do not interfere.
- [ ] Agent JSON output parsed identically to today. Chat shows same text format. No parsing regressions.
- [ ] `tsc --noEmit` passes with no errors.

## Context for Agent

- `PlanManager` is at `src/main/planManager.ts` — currently tightly couples `child_process.spawn` with `parseLine`/`onChunkCb`. Must be refactored so parsing is shared, spawning is swappable.
- IPC handlers at `src/main/ipc/plan.ts` — `plan:send` and `plan:cancel` are the primary handlers. New handlers `plan:reconnect`, `plan:tmux-check`, `plan:is-tmux-available` must be added.
- App quit at `src/main/index.ts:99` calls `cancelAllPlans()` → must change to `detachAllPlans()`.
- Task frontmatter read/write at `src/main/tasks.ts`. Fields `planTmuxSession` and `execTmuxSession` must be added to `buildFrontmatter()` and `parseTask()`.
- `PlanChat.tsx` session mount logic at `src/renderer/src/components/TaskDetail/PlanChat.tsx` lines 244–262 — this is where reconnect logic and banner must be added.
- FIFO directory: `path.join(os.homedir(), '.grove', 'pipes')` — use Node's `os.homedir()`, never rely on `$HOME` env var.
- opencode resume flag: `--session <id>` (already in `buildArgs()`). copilot resume flag: `--resume <id>` (already in `buildArgs()`).
- Workspace hash: `crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 6)` — deterministic, safe for tmux session names.
- tmux session names must match `[a-zA-Z0-9_-]` only. Task IDs like `T-022` are safe. Workspace hashes are hex, safe.
