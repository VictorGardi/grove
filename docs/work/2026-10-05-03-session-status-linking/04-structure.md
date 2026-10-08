---
feature: 2026-10-05-03-session-status-linking
phase: structure
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-06
based_on:
  - 03-design.md@1
  - parent:04-structure.md@5
forced: []
---

# Structure: session status, linking and resume

Six vertical slices inside the epic's scope for child 3 (E-D3, E-D5, E-D6,
E-D7). Each ends with `npm run typecheck` and `npm test` green, plus the
listed checks.

## Slices

### Slice 1 — Tracer: live working / idle

- **Outcome:** with the OpenCode service running, an OpenCode session card
  shows "working" during a turn and "idle" after it.
- **Files:** NEW `src/core/opencode/{types,client,normalise}.ts`,
  `normalise.test.ts`, `src/core/status.ts` + test,
  `src/core/testing/fakeOpenCode.ts`, `src/renderer/src/sessionStatus.ts` +
  test. MODIFIED `src/shared/types.ts` (`status?`), `src/core/core.ts`
  (`CoreOptions.opencode`, event wiring, strip `status` on save),
  `src/main/index.ts` (construct `HttpOpenCode`),
  `src/renderer/src/components/Sidebar.tsx` (status text/tone).
- **Signatures:** `OpenCodeSource.start(onEvent)`, `stop()`; `OcEvent`
  `connected | disconnected | exec-started | exec-ended`;
  `apply(trackers, roots, e)`; `statusOf(tracker, seenAt)`;
  `shownStatus(s)`.
- **Verify:** `npm test -- src/core/opencode/normalise.test.ts src/core/status.test.ts src/core/sessions.test.ts`
  (core test: `FakeOpenCode.emit({type:'exec-started'})` → `status: 'working'`;
  `state.json` has no `status`). Manual: `npm run dev`, new OpenCode session,
  send a prompt → card "working", then "idle".
- **Depends on:** —

### Slice 2 — Waiting on a permission or question

- **Outcome:** a blocked session shows "waiting · permission" or "waiting ·
  question"; subagent requests count for their parent; the TopBar shows
  "N waiting" (click focuses the longest-waiting); the linked feature's card
  state is `waiting`, and idle sessions no longer keep a card `running`.
- **Files:** MODIFIED `normalise.ts` (`permission.*`, `form.*`,
  `session.created` → `pending`, `child`), `status.ts` (`waitingFor`),
  `src/core/workflow/derive.ts` (roll-up), `src/shared/types.ts`
  (`waitingFor?`), `TopBar.tsx`, `App.tsx`.
- **Signatures:** `OcEvent` `pending | child`; `waitingFor: 'permission' | 'question'`.
- **Verify:** `npm test -- src/core/status.test.ts src/core/workflow/derive.test.ts src/core/opencode/normalise.test.ts`
  (precedence permission > question > working; child folded into root;
  waiting beats running; idle and terminal don't count). Manual: ask the
  agent to write a file outside the project → card "waiting · permission",
  header "1 waiting", feature card `waiting`; approve → "working".
- **Depends on:** 1

### Slice 3 — Re-sync, reconnect, fallback banner

- **Outcome:** on every connect grove snapshots tracked sessions; on
  disconnect cards fall back to tmux liveness and, after 5 s, a banner says
  the service is unreachable; grove reconnects (backoff, or at once on a
  `service.json` change); a non-2.0.20 service adds a version banner; an
  OpenCode crash (dead pane) shows gone.
- **Files:** MODIFIED `client.ts` (`snapshot`, backoff, 45 s silence,
  `service.json` watch), `core.ts` (snapshot on `connected`, clear on
  `disconnected`, `opencode` slice), `src/shared/{types,ipc}.ts`
  (`OpenCodeSlice`, `state:opencode`), `src/main/ipc.ts`,
  `src/renderer/src/stores/slices.ts`, `App.tsx` (banners),
  `src/core/backend/tmux.ts` (`list()` skips `#{pane_dead}`). NEW
  `src/core/opencode/client.test.ts`.
- **Signatures:** `snapshot(ids): Promise<Map<string, SessionSnapshot>>`;
  `OpenCodeSlice { state; version }`.
- **Verify:** `npm test -- src/core/opencode/client.test.ts src/core/sessions.test.ts src/core/backend/tmux.test.ts`
  (stub HTTP server: Basic auth header, SSE framing, reconnect after close,
  re-read `service.json`; core: disconnect clears `status`, snapshot restores
  a pending item; tmux: `sh -c 'exit 1'` not live). Manual: `opencode service
  stop` → banner within ~5 s, cards "running"; start a TUI → banner gone,
  statuses back.
- **Depends on:** 1, 2

### Slice 4 — Finished turn waits until seen; notifications

- **Outcome:** a turn that finishes while its session isn't on screen shows
  "waiting · done" until seen, also across restarts; a transition into
  waiting off screen fires a native `Notification` whose click focuses the
  session (invisible until signed, D3; `failed` logged once).
- **Files:** MODIFIED `src/shared/types.ts` (`seenAt`, `'done'`),
  `src/core/sessions.ts` (`seenAt: null`, `markSeen`),
  `src/core/store/stateStore.ts` (default `null`), `status.ts`, `core.ts`
  (`setWindowFocused`, on-screen rule, `on('notify')`, no notify on first
  snapshot), `src/main/index.ts` (focus/blur, `Notification`, click →
  focus + `uiSet`).
- **Signatures:** `Core.setWindowFocused(f: boolean)`;
  `Core.on('notify', cb: (s: Session) => void)`.
- **Verify:** `npm test -- src/core/status.test.ts src/core/sessions.test.ts src/core/store/stateStore.test.ts`
  (off-screen finish → `waiting/done` + one `notify`; focusing → idle,
  `seenAt` saved, a new core on the same `state.json` stays idle; on-screen
  finish → idle, no notify; first snapshot never notifies). Manual: finish a
  turn in a background session → "waiting · done"; click it → idle; restart
  → still idle; DevTools console shows one `failed`.
- **Depends on:** 3

### Slice 5 — Auto-link

- **Outcome:** an unpinned OpenCode session links to the feature folder it
  last wrote to (write/edit/patch, subagents included); a not-yet-discovered
  folder links once discovered; links catch up on every connect.
- **Files:** NEW `src/core/autolink.ts` + test. MODIFIED `normalise.ts`
  (`session.tool.called|success` → `wrote`, `patchText` headers; message
  parsing for `lastWrites`), `client.ts` (`lastWrites`), `core.ts` (apply
  links, held slug re-checked on `publish`, catch-up after snapshot).
- **Signatures:** `slugFor(paths, projectPath, featureRoot)`;
  `lastWrites(id): Promise<string[]>`; `OcEvent` `wrote`.
- **Verify:** `npm test -- src/core/autolink.test.ts src/core/opencode/normalise.test.ts src/core/features.test.ts`
  (relative, absolute, `/tmp` realpath, outside root, epic folder; pinned
  untouched; held slug applied after the fake watcher reports it; catch-up on
  connect). Manual: in an unlinked OpenCode session run `/grove-questions` on
  a new idea → card shows the new feature; restart grove → link kept.
- **Depends on:** 3

### Slice 6 — Resume

- **Outcome:** a gone OpenCode session offers Resume (card and "Session
  ended" view); it reopens the TUI with its history in a new tmux session
  with the same id, label and link.
- **Files:** MODIFIED `src/core/sessions.ts` (`resume`), `core.ts`
  (`sessionResume`), `src/shared/ipc.ts` (`session:resume`),
  `src/main/ipc.ts`, `Sidebar.tsx`, `App.tsx`.
- **Signatures:** `Commands.sessionResume({ id }): Promise<Result<Session>>`
  (`not-found | not-gone | not-opencode`).
- **Verify:** `npm test -- src/core/sessions.test.ts` (`create` with the same
  `tmuxName` and `opencode -s <id>` argv; `running`, `endedAt: null`; id,
  label, feature kept; error cases). Manual: `tmux -L grove kill-server` →
  cards gone with Resume → Resume opens the TUI with history; repeat once on
  a session interrupted mid-turn.
- **Depends on:** 1

## Appetite check

Six slices against the epic's 4 days / about 6 slices for this child: fits.
Resume is last and can be cut (epic appetite cut 3) without touching 1–5.

## Deferred

- Hands-on notification check (shows, click focuses, electron#51885): child 8's signed build
- Dock badge / bounce fallback; agents other than OpenCode
- Linking from `shell` or MCP tool writes

## Rollout / migration

`seenAt` missing in an existing `state.json` loads as `null`; no
`schemaVersion` bump, no migration. Live fields are never written.

## Open questions
