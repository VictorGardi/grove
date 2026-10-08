---
feature: 2026-10-05-03-session-status-linking
phase: design
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-06
based_on:
  - 01-questions.md@1
  - 02-research.md@2
  - parent:02-research.md@5
  - parent:03-design.md@5
  - parent:04-structure.md@5
forced: []
---

# Design: session status, linking and resume

Designed on draft research (v2), a soft-gate warning.

## Inherited decisions

- **E-D3** tmux on `-L grove`; resume = a new tmux session running `opencode -s <id>`.
- **E-D4** Core in Electron main behind an Electron-free seam.
- **E-D5** One SSE client on the shared OpenCode service, app-generated `-s ses_…` ids, HTTP re-sync on (re)connect; tmux for `gone`.
- **E-D6** Link to the feature folder of the latest edit/write; manual link pins; startup catch-up from session messages; terminals manual.
- **E-D7** Versioned JSON state, atomic writes, main as single writer; `Session` has `opencodeSessionId`, `feature`, `lastStatus`, `endedAt`.
- Epic two-way row **Notifications**: Electron `Notification` on → `waiting`, click focuses. Kept as is (D3), although unsigned builds can't show them (spike S1).

## Desired state

1. Each OpenCode session card shows **working**, **waiting** (a permission
   request, a question, or a finished turn not yet seen), **idle** or
   **gone**; terminals show running / gone. The header shows the waiting count.
2. A finished turn becomes idle once seen: the session is on screen while the
   grove window is focused. The "seen" mark survives restarts.
3. When a session starts waiting, grove alerts, unless the window is focused
   and that session is on screen. Clicking the alert focuses the session (D3).
4. Feature card state rolls up: `waiting` if any linked session waits, else
   `running` if any is working.
5. A non-pinned OpenCode session links itself to the feature folder in its own
   project it last wrote to (write/edit/patch, its subagents included). A
   write into a not-yet-discovered folder links once discovery sees it.
6. On app start and every reconnect, grove re-syncs status from the service
   and catches up links from each session's messages.
7. Service unreachable: cards show tmux liveness (running / gone) and a banner
   says so; grove reconnects by itself and follows restarts via
   `service.json`. Grove never starts or stops the service.
8. A gone OpenCode session offers **Resume**: a new tmux session
   `opencode -s <id>` in the project root, same id, label and link.

## Non-goals

- Answering permissions or questions from grove (done in the TUI)
- Status or linking for agents other than OpenCode (e.g. Claude Code; D2 leaves room)
- Fallback alerts (Dock badge / bounce) for the unsigned app (D3)
- Resuming terminals; link history; starting/stopping the service; reading its SQLite store
- Linking from `shell` or MCP tool writes; v1-migrated message shapes

## System design

### Session record (D1)

```ts
interface Session {            // existing fields unchanged
  lastStatus: 'running' | 'gone' // tmux liveness; Resume sets 'running' again
  seenAt: string | null          // NEW, persisted: when the human last saw it
  status?: 'working' | 'waiting' | 'idle'           // NEW, live-only (OpenCode, service connected)
  waitingFor?: 'permission' | 'question' | 'done'   // NEW, live-only, with status 'waiting'
}
type OpenCodeSlice = { state: 'connecting' | 'connected' | 'unreachable'; version: string | null } // NEW slice, not persisted
// shown status: 'gone' if lastStatus is gone, else status, else 'running' (terminal, or no service)
```

### OpenCode adapter contract (D2)

```ts
type OcEvent =
  | { type: 'connected'; version: string } | { type: 'disconnected' }
  | { type: 'exec-started'; sessionId: string }
  | { type: 'exec-ended'; sessionId: string; at: string }          // succeeded | failed | interrupted
  | { type: 'pending'; sessionId: string; id: string; kind: 'permission' | 'question'; open: boolean }
  | { type: 'child'; sessionId: string; parentId: string }
  | { type: 'wrote'; sessionId: string; paths: string[] }          // on tool success, raw paths
interface SessionSnapshot { running: boolean; idleAt: string | null; pending: { id: string; kind: 'permission' | 'question' }[]; children: string[] }
interface OpenCodeSource {
  start(onEvent: (e: OcEvent) => void): void    // connects, reconnects, follows service.json
  snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>>
  lastWrites(id: string): Promise<string[]>     // paths of the latest successful write/edit/patch
  stop(): void
}
```

Mapping inside the adapter: `session.execution.started` → `exec-started`;
`…succeeded|failed|interrupted` → `exec-ended`; `permission.asked|replied` and
`form.created|replied|cancelled` (session at `data.form.sessionID`) →
`pending`; `session.created` with `parentID` → `child`;
`session.tool.called` input (`path`, or `patchText` headers) held by tool id,
emitted as `wrote` on `session.tool.success`; `server.connected` → `connected`.

### Status rules (pure, core)

Core keeps a `Tracker` per root grove session; child-session events fold into
their root. Pending permission → `waiting/permission`; pending question →
`waiting/question`; running → `working`; `idleAt > seenAt` → `waiting/done`; else `idle`.

- **On screen** = window focused, `ui.view === 'list'`, no focused feature,
  `ui.focusedSessionId === s.id`. While on screen, `seenAt` is set to now on
  every status change and on becoming on screen (so `done` clears at once).
- **Notify**: a transition into `waiting` (from anything else, or a new
  `waitingFor`) while not on screen emits core `notify {sessionId}`. The
  first snapshot after app start never notifies; later re-syncs notify only
  real transitions.
- **Card roll-up**: `waiting` if any linked OpenCode session is waiting, else
  `running` if any is working; else the existing rules.

### Flows

- **Connect / re-sync:** service.json → `GET /api/info` → `/api/event` →
  `server.connected` → `snapshot(ids of live OpenCode sessions)` replaces the
  trackers → link catch-up (`lastWrites` for unpinned sessions).
- **Disconnect:** `status` cleared on all sessions (tmux liveness shows);
  `opencode.state` `connecting`, `unreachable` after 5 s; reconnect per SSE row.
- **Auto-link:** `wrote` → `slugFor` (two-way row Link matching) → `feature =
  slug` unless `linkPinned`; an unknown slug is held until `features` lists it.
- **Resume** (NEW invoke `session:resume {id}` → `Session`; `not-found`,
  `not-gone`, `not-opencode`): `backend.kill` leftover → `backend.create` same
  `tmuxName` with `opencode -s <id>` → `running`, `endedAt: null` → snapshot.
- **Notification (main):** core `notify` → `Notification` (label; "Needs
  permission" / "Has a question" / "Finished"); `click` → focus window +
  `uiSet({ view: 'list', focusedSessionId })`; `failed` logged once.
- NEW push `state:opencode`. Main calls `core.setWindowFocused` on focus/blur.

## Program design

Call path (new): `HttpOpenCode` (built in main, passed as `CoreOptions.opencode`)
→ `onEvent` → `status.apply` → `withStatus` → `set('sessions')` → derive + push;
transitions → `notify` → main. `wrote` → `autolink.slugFor` → `set('sessions')`.

### File tree

```
src/shared/types.ts                 MODIFIED  Session.seenAt/status/waitingFor, OpenCodeSlice, Slices.opencode
src/shared/ipc.ts                   MODIFIED  session:resume, state:opencode
src/core/opencode/types.ts          NEW       OcEvent, SessionSnapshot, OpenCodeSource
src/core/opencode/client.ts         NEW       HttpOpenCode: service.json, auth, SSE, reconnect, snapshot, lastWrites
src/core/opencode/normalise.ts      NEW       raw event / message → OcEvent / paths (+ .test.ts)
src/core/status.ts                  NEW       Tracker, apply, statusOf, withStatus, transitions (+ .test.ts)
src/core/autolink.ts                NEW       slugFor(path, projectPath, featureRoot, slugs) (+ .test.ts)
src/core/testing/fakeOpenCode.ts    NEW       emit(e), snapshots, writes
src/core/sessions.ts                MODIFIED  newSession seenAt: null, resume(), markSeen()
src/core/core.ts                    MODIFIED  opencode wiring, setWindowFocused, on('notify'), sessionResume
src/core/store/stateStore.ts        MODIFIED  seenAt default null; strip live fields
src/core/backend/tmux.ts            MODIFIED  list() skips sessions whose pane is dead
src/core/workflow/derive.ts         MODIFIED  card roll-up from status
src/main/index.ts                   MODIFIED  HttpOpenCode, focus/blur, Notification
src/main/ipc.ts                     MODIFIED  session:resume handler
src/renderer/src/stores/slices.ts   MODIFIED  opencode slice
src/renderer/src/components/shell/TopBar.tsx  MODIFIED  "N waiting" chip
src/renderer/src/components/Sidebar.tsx       MODIFIED  status text/tone, Resume button
src/renderer/src/App.tsx            MODIFIED  service banner, Resume in "Session ended"
src/renderer/src/sessionStatus.ts   NEW       shownStatus(s), label/tone (+ .test.ts)
```

### Key signatures

```ts
interface Tracker { running: boolean; pending: Map<string, 'permission' | 'question'>; idleAt: string | null; children: Set<string> }
function apply(t: Map<string, Tracker>, roots: Map<string, string>, e: OcEvent): Map<string, Tracker>  // status.ts
function statusOf(t: Tracker | undefined, seenAt: string | null): Pick<Session, 'status' | 'waitingFor'>
function slugFor(paths: string[], projectPath: string, featureRoot: string | null): string | null      // autolink.ts
interface CoreOptions { opencode?: OpenCodeSource }   // absent: tmux-only
interface Core { setWindowFocused(f: boolean): void; on(e: 'notify', cb: (s: Session) => void): () => void }
interface Commands { sessionResume(a: { id: string }): Promise<Result<Session>> }
```

Tests: `normalise` on captured 2.0.20 payloads; `status`, `autolink` pure; core
with `FakeOpenCode` + `FakeBackend`; `HttpOpenCode` against a local stub server.

## One-way decisions

- **D1 Status model and persistence.** `lastStatus` stays tmux liveness (`running | gone`), no longer terminal (Resume sets `running`). Live-only `status?: working | waiting | idle` and `waitingFor?: permission | question | done` on `Session`, stripped on save like `branch`. One new persisted field `seenAt: string | null`; "finished, unseen" = OpenCode `time.idle` > `seenAt`, recomputed on re-sync. Missing `seenAt` loads as `null`; `schemaVersion` stays 1. Rejected: persisted five-value `lastStatus` (stale on load, write per transition, every reader widened); separate unpersisted status slice (loses "seen" across restarts). [ADR 0015](../../adr/0015-live-session-status-with-persisted-seen-mark.md)
- **D2 OpenCode adapter boundary.** `src/core/opencode/` behind an `OpenCodeSource` interface (like `SessionBackend`) owns `service.json`, auth, SSE and HTTP, and emits agent-neutral `OcEvent`s and snapshots; status precedence, "seen" and link matching are pure functions in core; tests use a `FakeOpenCode`. A second agent (e.g. Claude Code via hooks + transcripts) would be another adapter emitting the same events, plus per-kind launch/resume argv (not in scope). Rejected: inline in `core.ts` (OpenCode shapes leak, needs a fake HTTP server); adapter owning status and linking (grove rules in the client, fake must re-implement them). No ADR: reuses the backend adapter pattern.
- **D3 Alerts on the unsigned app.** Native Electron `Notification` only, as the epic row says; no Dock fallback. Accepted consequence: nothing is shown until grove is code-signed (child 8). Rejected: native + Dock badge/bounce fallback; Dock only. No ADR: unchanged epic decision.

## Two-way decisions

| Area | Decision | Basis |
|---|---|---|
| Re-sync calls | Per tracked session: `/api/session/active`, `/session/:id/permission`, `/form`, `GET /session/:id` (`time.idle`, `outcome`); 404 = not started yet → idle. Not ADR 0005's per-location calls (service location defaults to `$HOME`) | Q5, S2 |
| SSE client | Node `fetch` streaming + small `data:` parser, no new dependency; backoff 1 s → 10 s; drop a stream silent 45 s (heartbeat 15 s); reconnect on `service.json` change | Q4, OpenCode's own client |
| Service file | `$XDG_STATE_HOME` or `~/.local/state/opencode/service.json`, Basic `opencode:<password>`; read in main only, never logged or pushed | Q3, epic risk |
| Subagents | Child ids from `session.created.parentID` (and `GET /api/session?parentID=` on re-sync); a child's pending items and writes count for its root grove session | Q8 |
| Link source | write/edit path from `session.tool.called` input, patch from `patchText` headers; committed on `session.tool.success`. Catch-up: latest successful such call from `GET …/message` (desc), on start and every reconnect. v2 shapes only (grove sessions are 2.0.20) | Q6, Q7, E-D6 |
| Link matching | Relative paths resolve against the project path; realpath both sides (best effort); must be under that project's feature root; first segment = slug. Unknown slug held per session until discovery reports it; a newer write replaces it | Q10, ADR 0006 |
| Card roll-up | Idle OpenCode sessions and terminals don't count (today any live linked session makes `running`, hiding `needs-review`) | epic card states |
| Dead pane | Live = tmux session exists **and** `#{pane_dead}` is 0, so an OpenCode exit ≠ 0 under `remain-on-exit failed` shows gone | research Unknowns |
| Resume | `session:resume {id}`, gone OpenCode sessions only: kill any leftover tmux session, create the same `tmuxName`; `lastStatus: running`, `endedAt: null`. Terminals: no resume | E-D3 |
| Window focus | Main forwards focus/blur as `core.setWindowFocused(bool)` | Q13, ADR 0004 |
| Service banner | New pushed slice `opencode: {state: connecting\|connected\|unreachable}`; banner after 5 s unreachable while any OpenCode session is live | ADR 0011 |
| Header | TopBar chip "N waiting"; click focuses the longest-waiting session | Q11 |
| Card text | working · waiting (permission / question / done) · idle · gone, existing `StatusTone`s | Q11 |

## Risks

- **Experimental API changes** (E-D5): all OpenCode shapes live in
  `normalise.ts`; a non-2.0.20 `version` adds a banner "untested OpenCode
  version"; a failing stream degrades to tmux liveness with the banner.
- **Notifications can't be seen unsigned** (D3, spike S1): the path is
  unit-tested via core's `notify`; the hands-on check (shows, click focuses,
  electron#51885) moves to child 8's signed build. If signing is cut, alerts
  stay invisible; in-app status and the header count still work.
- **Pending items dropped on service stop** without events (S2): every
  reconnect replaces trackers from a fresh snapshot.
- **`opencode -s` on an interrupted or other-directory session** was not run
  (research unknown): checked by hand in the Resume slice.
- **`service.json` is a secret**: read in main, never logged or pushed.

## Open questions
