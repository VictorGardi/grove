---
feature: 2026-10-05-03-session-status-linking
phase: plan
status: approved
version: 2
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: session status, linking and resume

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Tracer: live working / idle

Context (code at `745cfa5`): `createCore(opts)` in `src/core/core.ts` holds
`slices`; `set(k, v)` notifies listeners and, for `sessions`/`ui`, writes
`state.json` with `branch` stripped (`({ branch: _live, ...s }) => s`), then
re-derives features. `start()` loads config/state, syncs discovery, reconciles
tmux, then starts a 5 s poll; `dispose()` clears it. `sessionCreate` appends a
`newSession(...)` record. `src/core/**` is Electron-free and compiled by
`tsconfig.node.json`; `src/renderer/src/**` by `tsconfig.web.json` (no `node:`
imports); `src/shared/**` by both. Tests: vitest, node env, `src/**/*.test.ts`;
`setupCore()` (`src/core/testing/setup.ts`) builds cores on temp files with a
`FakeBackend`. `StatusTone` (`src/renderer/src/components/ui/StatusDot.tsx`)
already has `running | working | waiting | idle | finished | gone`.

OpenCode 2.0.20 facts used here (from `02-research.md` and the epic research):
the service registers `{id, version, url, pid, password}` in
`$XDG_STATE_HOME/opencode/service.json` (default `~/.local/state/opencode/service.json`);
clients send HTTP Basic `opencode:<password>`. `GET /api/info` → `{version, pid, urls, paths}`
(accept it bare or wrapped in `{data: …}`). `GET /api/event` is SSE with only
`data: <JSON>` frames separated by a blank line and `: heartbeat` comments; each
frame's JSON is the envelope `{id, type, created, data, location?}`. The first
frame is `server.connected`. `session.execution.started` has `data.sessionID`;
`session.execution.succeeded | failed | interrupted` have `data.sessionID` and
end a turn. `created` may be epoch ms or an ISO string. The password is never
logged, pushed, or put in an error message.

Slice 1 scope only: no snapshot, no pending/child events, no backoff (fixed
1 s retry), no `seenAt`. `OpenCodeSource` has only `start`/`stop` now; slices
3 and 5 add `snapshot` and `lastWrites`.

- [x] Create `src/core/opencode/types.ts`:
  `export type OcEvent = { type: 'connected'; version: string } | { type: 'disconnected' } | { type: 'exec-started'; sessionId: string } | { type: 'exec-ended'; sessionId: string; at: string }`
  and `export interface OpenCodeSource { start(onEvent: (e: OcEvent) => void): void; stop(): void }`.
- [x] Write failing test `src/core/opencode/normalise.test.ts` for
  `normalise(raw: unknown, version: string): OcEvent | null`, with envelope
  fixtures shaped as above: `server.connected` → `{type:'connected', version}`;
  `session.execution.started` → `exec-started` with `sessionId`;
  `succeeded`, `failed`, `interrupted` → `exec-ended` with `at` = ISO of
  `created` (number ms and ISO string both); `created` missing → `at` is an
  ISO string (current time); unrelated type (`session.step.started`) → `null`;
  missing `data.sessionID`, non-object, `null` → `null`.
- [x] Implement `src/core/opencode/normalise.ts` (`normalise`, plus a local
  `toIso(v: unknown): string`), all OpenCode shapes kept in this file.
- [x] Write failing test `src/core/opencode/client.test.ts` for the pure SSE
  splitter `sseData(buffer: string): { frames: string[]; rest: string }`
  exported from `client.ts`: two `data:` frames separated by `\n\n` → both
  JSON strings; a `: heartbeat` comment block → no frame; a trailing partial
  frame → kept in `rest`; `\r\n` line endings handled; multi-line `data:`
  joined with `\n`. Also `serviceFilePath(env, home)`: `XDG_STATE_HOME` set →
  `<it>/opencode/service.json`, else `<home>/.local/state/opencode/service.json`.
- [x] Implement `src/core/opencode/client.ts`: `export class HttpOpenCode implements OpenCodeSource`
  with constructor `{ serviceFile: string; retryMs?: number /* default 1000 */ }`.
  `start(onEvent)` runs a loop until `stop()`: read and `JSON.parse` the
  service file (`url`, `password`); `GET <url>/api/info` with the Basic header
  and a 2 s `AbortSignal.timeout`; then `GET <url>/api/event` with the Basic
  header and `Accept: text/event-stream` using one `AbortController` that
  `stop()` aborts; read `res.body` with a `TextDecoder`, feed `sseData`,
  `JSON.parse` each frame, `normalise(raw, version)`, call `onEvent` for
  non-null results. When a `connected` was emitted and the stream then ends or
  throws, emit `{type:'disconnected'}` once. Any failure (missing file, non-200,
  network error, bad JSON) waits `retryMs` and loops; nothing is logged.
  Also export `sseData` and `serviceFilePath(env: NodeJS.ProcessEnv, home: string): string`.
- [x] Write failing test `src/core/status.test.ts`:
  `apply(trackers, roots, e)` — `exec-started` creates/updates the root's
  tracker with `running: true`; `exec-ended` sets `running: false`,
  `idleAt: at`; an event whose `sessionId` is in `roots` folds into that root;
  `connected`/`disconnected` return the map unchanged; input map not mutated.
  `statusOf(undefined, null)` → `{ status: 'idle' }`; running tracker →
  `{ status: 'working' }`; not running → `{ status: 'idle' }`.
  `withStatus(sessions, trackers, connected)` — connected: opencode sessions
  get `statusOf(trackers.get(opencodeSessionId), null).status`, terminals
  untouched; not connected: `status` removed from every session; returns the
  same array when nothing changed.
- [x] Implement `src/core/status.ts`:
  `export interface Tracker { running: boolean; pending: Map<string, 'permission' | 'question'>; idleAt: string | null; children: Set<string> }`,
  `apply(t: Map<string, Tracker>, roots: Map<string, string>, e: OcEvent): Map<string, Tracker>` (root = `roots.get(id) ?? id`; new tracker `{running:false, pending:new Map(), idleAt:null, children:new Set()}`; returns a new Map with a new tracker object for the changed root),
  `statusOf(t: Tracker | undefined, _seenAt: string | null): Pick<Session, 'status'>` (slice 2 widens it to `'status' | 'waitingFor'`, slice 4 adds the `seenAt` rule),
  `withStatus(sessions: Session[], t: Map<string, Tracker>, connected: boolean): Session[]`
  (a session with `status === undefined` after the rule has no `status` key).
- [x] In `src/shared/types.ts` add to `Session`, after `branch`:
  `status?: 'working' | 'waiting' | 'idle' // OpenCode sessions while the service is connected; never saved`.
  (`waitingFor` is added in slice 2.)
- [x] Create `src/core/testing/fakeOpenCode.ts`: `export class FakeOpenCode implements OpenCodeSource`
  with `started = false`, `stopped = false`, `start(cb)` stores `cb`,
  `emit(e: OcEvent)` calls it (throws if not started), `stop()` sets `stopped`.
- [x] In `src/core/testing/setup.ts` construct `const oc = new FakeOpenCode()`,
  pass `opencode: oc` to `createCore`, and return `oc` from `setupCore()`.
  Add `createOpenCode(core, projectId = 'p')` mirroring `createTerminal` with
  `kind: 'opencode'`.
- [x] Write failing tests in `src/core/sessions.test.ts`, `describe('core opencode status')`:
  after `start()` and `oc.emit({type:'connected', version:'2.0.20'})`, a new
  OpenCode session has `status: 'idle'`, a terminal has no `status`;
  `exec-started` with its `opencodeSessionId` → `'working'`, and the
  `state.json` session has no `status` key; `exec-ended` → `'idle'`;
  `disconnected` → no `status`; `dispose()` → `oc.stopped`.
- [x] In `src/core/core.ts`: add `opencode?: OpenCodeSource // absent: tmux-only`
  to `CoreOptions`; keep `let trackers = new Map<string, Tracker>()`,
  `const roots = new Map<string, string>()`, `let ocConnected = false`;
  `function refreshStatus()` sets `sessions` to `withStatus(slices.sessions, trackers, ocConnected)`
  when it returns a new array; `function onOcEvent(e)`: `connected` →
  `ocConnected = true`, `trackers = new Map()`; `disconnected` →
  `ocConnected = false`, `trackers = new Map()`; else
  `trackers = apply(trackers, roots, e)`; then `refreshStatus()`. In `set`,
  strip `status` too: `({ branch: _branch, status: _status, ...s }) => s` with
  comment `// live-only`. In `sessionCreate` call `refreshStatus()` after the
  `set`. At the end of `start()` call `opts.opencode?.start(onOcEvent)`; in
  `dispose()` call `opts.opencode?.stop()`.
- [x] In `src/main/index.ts` pass
  `opencode: new HttpOpenCode({ serviceFile: serviceFilePath(process.env, os.homedir()) })`
  to `createCore` (import from `../core/opencode/client`).
- [x] Write failing test `src/renderer/src/sessionStatus.test.ts`:
  `shownStatus(s)` → `'gone'` when `lastStatus` is gone (even with `status`),
  else `s.status`, else `'running'`; `statusView(s)` → `{ label, tone }` with
  label = tone = the shown status.
- [x] Implement `src/renderer/src/sessionStatus.ts`:
  `export type ShownStatus = 'running' | 'gone' | 'working' | 'waiting' | 'idle'`,
  `shownStatus(s: Session): ShownStatus`,
  `statusView(s: Session): { label: string; tone: StatusTone }` (type import of
  `StatusTone` from `./components/ui/StatusDot`).
- [x] Use it: `src/renderer/src/components/Sidebar.tsx` line `status={{ label: s.lastStatus, tone: s.lastStatus }}`
  → `status={statusView(s)}`; same in `src/renderer/src/components/FeaturePage.tsx`
  (`x.lastStatus` → `statusView(x)`).
- [x] Run `npm test -- src/core/opencode/normalise.test.ts src/core/status.test.ts src/core/sessions.test.ts`
  plus `npm test -- src/core/opencode/client.test.ts src/renderer/src/sessionStatus.test.ts`,
  then `npm test` and `npm run typecheck`.
- [x] Manual (human): `npm run dev` with the OpenCode service running, new
  OpenCode session, send a prompt → card "working", then "idle".

## Slice 2 — Waiting on a permission or question

Context (code at `2b37445`, after slice 1): `src/core/opencode/normalise.ts`
`normalise(raw, version)` maps the envelope `{id, type, created, data}`;
`src/core/status.ts` has `Tracker {running, pending, idleAt, children}`,
`apply(t, roots, e)` (root = `roots.get(id) ?? id`, returns a new Map),
`statusOf(t, _seenAt): Pick<Session, 'status'>`, `withStatus(sessions, t, connected)`;
`src/core/core.ts` keeps `trackers`, `roots` (empty so far), `ocConnected`,
`onOcEvent(e)` → `refreshStatus()`; `set()` strips `branch` and `status` on
save. `deriveFeatures` (`src/core/workflow/derive.ts`) sets `running` when any
session with the same `projectId` and `feature === slug` has
`lastStatus === 'running'`, with `done` checked first. Renderer:
`src/renderer/src/sessionStatus.ts` (`shownStatus`, `statusView`),
`TopBar({ onNew })` in `src/renderer/src/components/shell/TopBar.tsx`, store
`useSlices` in `src/renderer/src/stores/slices.ts` (sessions set from the
`state:sessions` push and from `state:get` in `hydrate`). `ui:set` with
`focusedSessionId` clears `focusedFeature` in core.

OpenCode 2.0.20 event shapes (research Q4/Q8, epic Q4, spike S2):
`permission.asked` data `{id: "per_…", sessionID, action, resources, …}`;
`permission.replied` data `{sessionID, requestID, reply}`;
`form.created` data `{form: {id: "frm_…", sessionID, metadata: {kind}, …}}`
(the session id is at `data.form.sessionID`); `form.replied` data
`{id, sessionID, answer}`; `form.cancelled` settles a form (read `id` and
`sessionID` from `data`, falling back to `data.form`); `session.created`
data carries the new session's id and, for a subagent, `parentID` (read the id
from `data.sessionID`, else `data.id`, else `data.info.id`; the parent from
`data.parentID`, else `data.info.parentID`). Every form counts as a
question (design: `form.*` → `pending` kind `question`).

Rules (design "Status rules", two-way rows Subagents and Card roll-up): a
child's pending items count for its root. Precedence: pending permission →
`waiting/permission`; pending question → `waiting/question`; running →
`working`; else `idle`. A child's own `exec-*` events do not change its root's
`running` (the parent's turn spans the subagent; folding a child's end would
mark the parent idle mid-turn). Card: `done` first; then `waiting` if any
linked session with `lastStatus 'running'` has `status 'waiting'`; then
`running` if any such session has `status 'working'`; then the existing
backlog / needs-review / ready rules. Idle OpenCode sessions, terminals, and
sessions without a live status no longer make a card `running`.

Header: "N waiting" counts sessions whose shown status is `waiting`; it is
hidden at 0. "Longest-waiting" uses the time the renderer first saw each
session waiting (kept in the store, dropped when the session stops waiting);
ties and unknowns fall back to session order.

- [x] In `src/core/opencode/types.ts` add to `OcEvent`:
  `| { type: 'pending'; sessionId: string; id: string; kind: 'permission' | 'question'; open: boolean }`
  `| { type: 'child'; sessionId: string; parentId: string }`.
- [x] Extend `src/core/opencode/normalise.test.ts` (failing first):
  `permission.asked` → `pending` open `permission` with `id`;
  `permission.replied` → `pending` closed with `id = requestID`;
  `form.created` → `pending` open `question` with `sessionId = data.form.sessionID`;
  `form.replied` and `form.cancelled` → `pending` closed `question`;
  `session.created` with `parentID` → `child`; without `parentID` → `null`;
  missing ids → `null`.
- [x] Implement those mappings in `src/core/opencode/normalise.ts` (before the
  existing `data.sessionID` check, since `form.created` has no
  `data.sessionID`).
- [x] In `src/shared/types.ts` add after `status`:
  `waitingFor?: 'permission' | 'question' // with status 'waiting'; never saved`.
- [x] Extend `src/core/status.test.ts` (failing first): `pending` open adds to
  the root's `pending`, closed removes it; a child's `pending` (via `roots`)
  lands on the root; a child's `exec-started`/`exec-ended` leave the root
  unchanged (same map returned); `child` adds the child id to the root's
  `children`. `statusOf`: permission + question pending + running →
  `{status:'waiting', waitingFor:'permission'}`; question + running →
  `waiting/question`; running only → `{status:'working'}`; `idle` has no
  `waitingFor` key. `withStatus` sets and removes `waitingFor` with `status`
  (key absent when not waiting), same array when unchanged.
- [x] In `src/core/status.ts`: `apply` handles `pending` (root via `roots`;
  copy the tracker and its `pending` Map; `set(id, kind)` when open, `delete(id)`
  when closed) and `child` (root = `roots.get(parentId) ?? parentId`; copy the
  tracker with a new `children` Set including `sessionId`); `exec-*` with
  `roots.has(sessionId)` returns `t` unchanged. `statusOf` returns
  `Pick<Session, 'status' | 'waitingFor'>` per the precedence above.
  `withStatus` compares and writes both `status` and `waitingFor`, omitting
  each key when `undefined`.
- [x] In `src/core/core.ts` `onOcEvent`: on `child`, first
  `roots.set(e.sessionId, roots.get(e.parentId) ?? e.parentId)`, then `apply`.
  Clear `roots` on `connected`/`disconnected` with the trackers. In `set`, strip
  `waitingFor` too: `({ branch: _branch, status: _status, waitingFor: _waitingFor, ...s }) => s`.
- [x] Add a core test to `src/core/sessions.test.ts` `describe('core opencode status')`:
  a `child` of the session then a `pending` open permission on the child →
  session `status 'waiting'`, `waitingFor 'permission'`, and the saved
  `state.json` session has neither key; closing it → `'idle'`.
- [x] Update `src/core/workflow/derive.test.ts` card-state table (the
  `session(over)` helper is a terminal linked to `a`): replace
  `'running with a linked running session'` with
  `['not running with a live terminal', …, {}, 'ready']`; add
  `['running with a working OpenCode session', …, { kind: 'opencode', status: 'working' }, 'running']`,
  `['not running with an idle OpenCode session', …, { kind: 'opencode', status: 'idle' }, 'ready']`,
  `['waiting with a waiting OpenCode session', …, { kind: 'opencode', status: 'waiting', waitingFor: 'question' }, 'waiting']`,
  `['not waiting when the session is gone', …, { kind: 'opencode', status: 'waiting', lastStatus: 'gone' }, 'ready']`;
  change `'done even with a running session'` to use `{ kind: 'opencode', status: 'working' }`.
  Add one test: two linked sessions, one `working` and one `waiting` → `waiting`.
- [x] In `src/core/workflow/derive.ts` replace the `running` line with
  `const linked = sessions.filter((s) => s.projectId === f.projectId && s.feature === f.slug && s.lastStatus === 'running')`,
  `const waiting = linked.some((s) => s.status === 'waiting')`,
  `const running = linked.some((s) => s.status === 'working')`, and the
  card rule `current < 0 ? 'done' : waiting ? 'waiting' : running ? 'running' : …`.
- [x] Extend `src/renderer/src/sessionStatus.test.ts` (failing first):
  `statusView` of `waiting/permission` → `{label:'waiting · permission', tone:'waiting'}`,
  `waiting/question` → `'waiting · question'`;
  `trackWaiting(prev: Record<string, number>, sessions, now: number): Record<string, number>`
  keeps an existing time, adds `now` for a newly waiting session, drops
  sessions no longer waiting (shown status) and returns `prev` itself when
  nothing changed; `longestWaiting(sessions, since): Session | null` → the
  waiting session with the smallest `since` (missing counts as `Infinity`,
  ties keep array order), `null` when none waits.
- [x] Implement in `src/renderer/src/sessionStatus.ts`: `statusView` label
  `` `waiting · ${s.waitingFor}` `` when shown status is `waiting` and
  `waitingFor` is set; `trackWaiting`; `longestWaiting`.
- [x] In `src/renderer/src/stores/slices.ts`: add `waitingSince: Record<string, number>`
  (initial `{}`) and `showSession(id: string): void` (invokes `ui:set` with
  `{ view: 'list', focusedSessionId: id }`). Set sessions through a local
  `setSessions(sessions)` that also sets
  `waitingSince: trackWaiting(get().waitingSince, sessions, Date.now())`;
  use it in the `state:sessions` handler and, in `hydrate`, after `state:get`
  (`set(slices.data)` then `setSessions(slices.data.sessions)`).
- [x] In `src/renderer/src/components/shell/TopBar.tsx` add props
  `waiting: number` and `onWaiting: () => void`; in the right-hand grid cell
  (currently `<div />`) render, when `waiting > 0`,
  `<Button size="sm" variant="secondary" className={cx(s.waiting, 'app-no-drag')} onClick={onWaiting}>{waiting} waiting</Button>`
  inside `<div className={s.right}>`; else the empty `<div />`. In
  `TopBar.module.css` add `.right { display: flex; justify-content: flex-end; }`
  and `.waiting { color: var(--text); }` (no inline styles: the renderer test
  `noInlineStyles.test.ts` forbids them).
- [x] In `src/renderer/src/App.tsx`: read `waitingSince` and `showSession`
  from `useSlices()`; compute `const waitingCount = sessions.filter((x) => shownStatus(x) === 'waiting').length`;
  pass `<TopBar onNew={() => openNew()} waiting={waitingCount} onWaiting={() => { const w = longestWaiting(sessions, waitingSince); if (w) showSession(w.id) }} />`.
- [x] Run `npm test -- src/core/status.test.ts src/core/workflow/derive.test.ts src/core/opencode/normalise.test.ts`,
  then `npm test -- src/core/sessions.test.ts src/renderer/src/sessionStatus.test.ts`,
  `npm test` and `npm run typecheck`.
- [x] Manual (human, run with a question instead; see 06-implementation.md): in an OpenCode session, ask the agent to write a file
  outside the project → card "waiting · permission", header "1 waiting",
  linked feature card `waiting`; approve → "working". Click "1 waiting" from
  another session → that session is focused.

## Slice 3 — Re-sync, reconnect, fallback banner

Context (code at `e597d53`, after slice 2): `src/core/opencode/client.ts`
`HttpOpenCode({ serviceFile, retryMs? })` loops: read `service.json` (`url`,
`password`) → `GET /api/info` (2 s timeout, version from `data.version` or
`version`) → `GET /api/event` SSE, feeding `sseData` → `normalise`; emits
`disconnected` once after a `connected` stream ends; fixed `retryMs` (1 s)
between attempts; exports `sseData`, `serviceFilePath`. `src/core/opencode/types.ts`
has `OcEvent` and `OpenCodeSource { start, stop }`. `src/core/status.ts` has
`Tracker`, `apply`, `statusOf`, `withStatus`. `src/core/core.ts` `onOcEvent`:
`connected`/`disconnected` set `ocConnected` and reset `trackers` and `roots`;
other events `apply`; then `refreshStatus()`. `set(k, v)` saves `state.json`
for every slice except `projects` (config) and `features`. `src/main/ipc.ts`
pushes every slice as `state:${key}`. Renderer store `useSlices`
(`src/renderer/src/stores/slices.ts`) subscribes per slice in `hydrate`.
`Banner({ tone: 'error' | 'info', children })` in `src/renderer/src/components/ui/Banner.tsx`;
`App.tsx` passes `banners` to `AppShell`. `TmuxBackend.list()`
(`src/core/backend/tmux.ts`) runs `list-sessions -F '#{session_name}'`;
`resources/tmux.conf` sets `remain-on-exit failed`, so an OpenCode exit ≠ 0
leaves a dead pane in a live session. The real-tmux tests in
`src/core/backend/tmux.test.ts` fail inside the Claude Code sandbox
(`posix_spawnp`); run them outside it.

OpenCode 2.0.20 re-sync facts (research Q5, S2; design two-way row "Re-sync
calls"). All responses are JSON, usually wrapped as `{data: …}` (accept bare too):
`GET /api/session/active` → `{data: {[sessionID]: {type: "running"}}}`,
present means running (a blocked turn still shows running);
`GET /api/session/:id` → `{data: {id, parentID?, outcome?, time: {created, updated, idle?}}}`
(`time.idle` epoch ms or ISO; absent → `idleAt: null`), 404 when the session
has not started yet (→ blank snapshot: not running, idle, nothing pending);
`GET /api/session/:id/permission` → `{data: [{id: "per_…", …}]}`;
`GET /api/session/:id/form` → `{data: [{id: "frm_…", …}]}` (every form is a
question); `GET /api/session?parentID=<id>` → `{data: [Session.Info]}` (also
accept `{data: {items: […]}}`), the subagent children. A service stop drops
pending items without events, so every connect replaces the trackers from a
fresh snapshot.

Rules (design flows *Connect / re-sync*, *Disconnect*; rows SSE client,
Service banner, Dead pane; risk Experimental API):
- Connect: on `connected`, core snapshots the `opencodeSessionId`s of OpenCode
  sessions with `lastStatus 'running'` and replaces `trackers` and `roots`
  from it. Events arriving while the snapshot is in flight are queued and
  re-applied on top of it; a snapshot that resolves after a later
  `connected`/`disconnected` is dropped; a failed snapshot keeps the event-built
  trackers.
- Disconnect: `status` cleared (already), `opencode` slice
  `{state: 'connecting', version: null}`, and `unreachable` 5 s later unless
  connected again. The same 5 s timer runs from `start()`.
- Client reconnect: backoff 1 s, doubling to at most 10 s, reset after a
  `connected`; a stream with no bytes for 45 s is aborted (heartbeat is 15 s);
  a change of `service.json` (polled with `fs.watchFile`, 1 s) aborts the
  current attempt or sleep and reconnects at once. Nothing is logged; the
  password never leaves the client.
- Banners (renderer): "OpenCode service unreachable — showing tmux status only"
  (tone `error`) while `opencode.state === 'unreachable'` and any OpenCode
  session has `lastStatus 'running'`; "Untested OpenCode version <v> (grove
  is tested with 2.0.20)" (tone `info`) while connected with a version other
  than `2.0.20`.
- Dead pane: a session is live only if it exists and its pane is not dead.

- [x] In `src/core/opencode/types.ts` add
  `export interface SessionSnapshot { running: boolean; idleAt: string | null; pending: { id: string; kind: 'permission' | 'question' }[]; children: string[] }`
  and `snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> // ids and their children; a session OpenCode doesn't know yet is blank`
  to `OpenCodeSource`.
- [x] Extend `src/core/opencode/normalise.test.ts` (failing first) for
  `unwrap(body: unknown): unknown` (`{data: x}` → `x`, else the body),
  `childIds(body: unknown): string[]` (array or `{items}` of objects → their
  string `id`s, else `[]`), and
  `snapshotOf(info: unknown, active: unknown, permissions: unknown, forms: unknown): SessionSnapshot`
  (info `null` → blank `{running:false, idleAt:null, pending:[], children:[]}`;
  `running` = info `id` is a key of `active`; `idleAt` = ISO of `time.idle`
  (number ms and ISO string) or `null`; `pending` = permission `id`s as
  `permission` then form `id`s as `question`, non-arrays and items without a
  string `id` skipped; `children: []`).
- [x] Implement `unwrap`, `childIds`, `snapshotOf` in `src/core/opencode/normalise.ts`
  (all shapes stay in this file; `snapshotOf` takes already-unwrapped bodies).
- [x] Extend `src/core/status.test.ts` (failing first) for
  `fromSnapshot(snaps: Map<string, SessionSnapshot>, ids: string[]): { trackers: Map<string, Tracker>; roots: Map<string, string> }`:
  each id with a snapshot gets `{running, idleAt, children: Set(children), pending}`
  where `pending` holds its own items plus each child's (child snapshots read
  from `snaps`, missing child → none); each child maps to its root in `roots`;
  an id without a snapshot gets no tracker.
- [x] Implement `fromSnapshot` in `src/core/status.ts`.
- [x] Write failing tests in `src/core/opencode/client.test.ts`,
  `describe('HttpOpenCode')`, against a local `node:http` stub on
  `127.0.0.1:0` (helper in the test file: `stub(password, handler)` →
  `{ url, close, requests }`, and a temp `service.json` writer). Construct with
  `{ serviceFile, retryMs: 10, maxRetryMs: 20, silenceMs, watchMs: 20 }`:
  - sends `authorization: Basic base64("opencode:<password>")` on `/api/info`
    and `/api/event`, and emits `{type:'connected', version}` from the info
    version after the `server.connected` frame;
  - a frame split over two writes (`session.execution.started`) emits one
    `exec-started`;
  - the server ending the stream → `disconnected`, then a new `connected`;
  - a stream silent for `silenceMs: 50` → `disconnected` then `connected`;
  - with `retryMs: 60000`, rewriting `service.json` to point at a second stub
    (other password) connects to it without waiting for the retry;
  - `snapshot(['ses_a', 'ses_new'])` with `ses_a` active, idle at a ms time,
    one permission, one form and child `ses_c` (with one form) → entries for
    `ses_a` (children `['ses_c']`), `ses_c`, and `ses_new` (404 → blank);
  - `stop()` → no further requests.
- [x] Rework `src/core/opencode/client.ts`: constructor
  `{ serviceFile: string; retryMs?: number /* 1000 */; maxRetryMs?: number /* 10000 */; silenceMs?: number /* 45000 */; watchMs?: number /* 1000 */ }`.
  Keep the connected service as `private svc: { url: string; headers: Record<string, string> } | null`
  (set after `/api/info` succeeds, cleared when the attempt ends).
  `start` also calls `fs.watchFile(serviceFile, { interval: watchMs }, kick)`;
  `stop` calls `fs.unwatchFile(serviceFile, kick)`. `kick` aborts the current
  attempt's `AbortController` and resolves the current backoff sleep early
  (an interruptible sleep: `new Promise` whose resolver is kept in a field).
  The loop: `delay = retryMs`; after an attempt that emitted `connected`,
  `delay = retryMs`; else `delay = Math.min(delay * 2, maxRetryMs)` after
  sleeping `delay`. The event fetch uses the attempt's controller; a
  `setTimeout(silenceMs)` re-armed on every chunk aborts it.
  `snapshot(ids)`: throws `'not connected'` without `svc`; `get(path)` fetches
  with the Basic headers and `AbortSignal.timeout(5000)`, returns `null` on
  404, throws on other non-2xx, else `unwrap(await res.json())`. Reads
  `/api/session/active` once; per id (`encodeURIComponent`), reads
  `/api/session/:id` (null → blank snapshot, no further calls), then
  `/permission`, `/form` (`?? []`), `snapshotOf(...)`, then children from
  `/api/session?parentID=<id>` via `childIds`, and the same snapshot for each
  child (its `children` left `[]`). Returns the map of all of them.
- [x] In `src/core/testing/fakeOpenCode.ts` add `snapshots = new Map<string, SessionSnapshot>()`,
  `snapshotCalls: string[][] = []`, and `async snapshot(ids)` recording `ids`
  and returning the entries of `snapshots` for `ids` plus their children.
- [x] In `src/shared/types.ts` add
  `export interface OpenCodeSlice { state: 'connecting' | 'connected' | 'unreachable'; version: string | null } // not persisted`,
  `opencode: OpenCodeSlice` in `Slices`, and
  `export const OPENCODE_CONNECTING: OpenCodeSlice = { state: 'connecting', version: null }`.
  In `src/shared/ipc.ts` add `'state:opencode': OpenCodeSlice` to `PushMap`.
- [x] Write failing core tests in `src/core/sessions.test.ts`
  `describe('core opencode status')`: (1) after `start()`, `opencode` slice is
  `connecting`; `connected` (version `'2.0.20'`) → `{state:'connected', version:'2.0.20'}`
  and `oc.snapshotCalls` holds the live OpenCode session's id (not a
  terminal, not a gone session); (2) a snapshot with a pending permission
  for the session → `waiting`/`permission` after the snapshot resolves;
  (3) a snapshot whose child has a pending form → `waiting`/`question`, and a
  later `pending` close on the child (no `child` event) → `idle`;
  (4) `disconnected` → `status` cleared, slice `connecting`, and, with
  `vi.useFakeTimers({ toFake: ['setTimeout'] })` + `vi.advanceTimersByTime(5000)`,
  `unreachable`; a `connected` before 5 s keeps it `connected`;
  (5) `state.json` has no `opencode` key.
- [x] In `src/core/core.ts`: initial `opencode: OPENCODE_CONNECTING` in
  `slices`; `set` saves `state.json` only for `sessions` and `ui`
  (`else if (k === 'sessions' || k === 'ui')`). Add
  `let unreachableTimer`, `armUnreachable()` (clears and sets a 5000 ms
  `setTimeout` that sets `opencode` to `{ state: 'unreachable', version: null }`),
  `let syncGen = 0` and `let queue: OcEvent[] | null = null`. `onOcEvent`:
  `connected` → `ocConnected = true`, reset trackers/roots, clear the timer,
  `set('opencode', { state: 'connected', version: e.version })`, `resync()`;
  `disconnected` → `ocConnected = false`, reset, `syncGen++`, `queue = null`,
  `set('opencode', OPENCODE_CONNECTING)`, `armUnreachable()`; other events:
  push to `queue` when it is not `null`, and apply as today either way. Then
  `refreshStatus()`. `async function resync()`: `const gen = ++syncGen`,
  `queue = []`, ids = `opencodeSessionId` of sessions with `kind 'opencode'`
  and `lastStatus 'running'`; `await opts.opencode.snapshot(ids)` in
  `try/catch` (on error: if `gen === syncGen` set `queue = null`; return);
  if `gen !== syncGen` return; `const r = fromSnapshot(snaps, ids)`; set
  `roots` to `r.roots`, `trackers = r.trackers`; replay the queued events
  through the same `child`/`apply` code; `queue = null`; `refreshStatus()`.
  In `start()` call `armUnreachable()` before `opts.opencode.start`, only when
  `opts.opencode` is set. `dispose()` clears the timer.
- [x] In `src/renderer/src/stores/slices.ts` add `opencode: OpenCodeSlice`
  (initial `OPENCODE_CONNECTING`) and `api.on('state:opencode', (opencode) => set({ opencode }))`.
- [x] Extend `src/renderer/src/sessionStatus.test.ts` (failing first) for
  `serviceBanners(oc: OpenCodeSlice, sessions: Session[]): { tone: 'error' | 'info'; text: string }[]`:
  unreachable with a live OpenCode session → the unreachable banner;
  unreachable with only terminals or gone OpenCode sessions → none;
  connecting → none; connected `2.0.20` → none; connected `2.1.0` → the
  version banner.
- [x] Implement `serviceBanners` in `src/renderer/src/sessionStatus.ts` with
  the texts above, and render them in `src/renderer/src/App.tsx` after the
  workflow banner: `...serviceBanners(opencode, sessions).map((b) => <Banner key={b.text} tone={b.tone}>{b.text}</Banner>)`.
- [x] Add a failing real-tmux test to `src/core/backend/tmux.test.ts`:
  `create` with `argv: ['sh', '-c', 'exit 1']`, wait until tmux shows
  `#{pane_dead}` = 1 for it (poll `display-message -p -t =<name>: '#{pane_dead}'`
  up to 3 s), then `list()` does not have it and `has-session` still succeeds.
- [x] In `src/core/backend/tmux.ts` `list()`: format `'#{session_name}\t#{pane_dead}'`,
  keep names whose second field is not `1`.
- [x] Run `npm test -- src/core/opencode/client.test.ts src/core/sessions.test.ts src/core/backend/tmux.test.ts`
  (the tmux file outside the sandbox), then
  `npm test -- src/core/opencode/normalise.test.ts src/core/status.test.ts src/renderer/src/sessionStatus.test.ts`,
  `npm test`, `npm run typecheck` and `npm run build`.
- [x] Manual (human): with an OpenCode session open in grove, `opencode service stop`
  → banner within ~5 s, cards "running"; start a TUI (`opencode`) → banner
  gone, statuses back.

## Slice 4 — Finished turn waits until seen; notifications

Context (code at `7743571`, after slice 3): `src/core/status.ts`
`statusOf(t, _seenAt)` ignores `seenAt` (precedence permission > question >
working > idle); `withStatus(sessions, t, connected)` calls
`statusOf(t.get(opencodeSessionId), null)`. `Tracker.idleAt` is the ISO time
the last turn ended (from `exec-ended` or the snapshot's `time.idle`).
`src/core/core.ts`: `refreshStatus()` sets `sessions` from `withStatus`; it
runs after every OpenCode event, after a re-sync (`resync()`, which keeps
`queue` non-null while the snapshot is in flight), and after `sessionCreate`.
`uiSet(partial)` merges into `ui` (focusing a session clears `focusedFeature`
and vice versa). `Core.on(e: 'slice', cb)` is the only event. `set` saves
`sessions`/`ui` to `state.json`, stripping `branch`, `status`, `waitingFor`.
`src/core/sessions.ts` `newSession` builds the record; `src/core/store/stateStore.ts`
`loadState` fills `sessions ?? []` and merges `ui` with `DEFAULT_UI`.
`src/main/index.ts` builds the `BrowserWindow` `win` and calls
`core.checkLiveness()` on `focus`. Renderer `statusView` already labels
`waiting · <waitingFor>`, so `waiting · done` needs no renderer change. Real
notifications cannot show on the unsigned app (design D3), so the main-process
path is checked by hand only for "failed logged once"; the hands-on display
check is deferred to child 8.

Rules (design D1, "Status rules", flow *Notification (main)*, row Window focus):
- Precedence: pending permission → `waiting/permission`; pending question →
  `waiting/question`; running → `working`; `idleAt` set and (`seenAt` null or
  `idleAt > seenAt`, ISO string comparison) → `waiting/done`; else `idle`.
- **On screen** = window focused, `ui.view === 'list'`, `ui.focusedFeature`
  null, `ui.focusedSessionId === s.id`. For an on-screen OpenCode session,
  `seenAt` is set to now when its `status`/`waitingFor` changes and when it
  becomes on screen (another id, or the window/view/feature condition turning
  true), so `done` clears at once.
- **Notify**: core keeps, per session id, the `waitingFor` it was last seen
  waiting with. Transitions are evaluated only while connected and no snapshot
  is in flight (`queue === null`), and only for OpenCode sessions with
  `lastStatus 'running'`. A session whose `status` is `waiting` with a
  `waitingFor` different from the kept one → keep it, and emit `notify` with
  the session unless it is on screen or this is the first evaluation after
  app start (the first re-sync, successful or not, primes the map without
  notifying). A session with a defined non-waiting `status` → forget it. A
  session without `status` (disconnected) keeps its entry, so a reconnect
  notifies only real changes.
- Main: `notify` → `new Notification({ title: s.label, body })`, body
  "Needs permission" / "Has a question" / "Finished" for
  `permission` / `question` / `done`; kept in a `Set` until `close`/`click`
  so it isn't garbage-collected; `click` → restore/show/focus `win` and
  `core.commands.uiSet({ view: 'list', focusedSessionId: s.id })`; the first
  `failed` is `console.error`-ed once per app run (main-process log, the
  terminal running `npm run dev`).

- [x] In `src/shared/types.ts` `Session`: add after `lastStatus`
  `seenAt: string | null           // ISO, when the human last saw it (on screen); persisted`
  and widen `waitingFor` to `'permission' | 'question' | 'done'`.
- [x] Add `seenAt: null` to the hand-built `Session` literals in
  `src/renderer/src/tree.test.ts` and `src/renderer/src/sessionStatus.test.ts`.
- [x] Extend `src/core/store/stateStore.test.ts` (failing first): a saved file
  whose session has no `seenAt` loads with `seenAt: null`; round-trip keeps a
  set `seenAt`.
- [x] In `src/core/store/stateStore.ts` `loadState`: map sessions
  `(x) => ({ ...x, seenAt: x.seenAt ?? null })`.
- [x] In `src/core/sessions.ts`: `newSession` sets `seenAt: null`; add
  `export function markSeen(s: Session, at: string): Session { return { ...s, seenAt: at } }`.
- [x] Extend `src/core/status.test.ts` (failing first): `statusOf` with an
  `idleAt` and `seenAt` null → `{status:'waiting', waitingFor:'done'}`;
  `idleAt` after `seenAt` → `done`; `idleAt` at or before `seenAt` → `idle`;
  running with an `idleAt` → `working`; a pending question beats `done`.
  `withStatus` reads each session's `seenAt`.
- [x] In `src/core/status.ts`: `statusOf(t, seenAt)` implements the
  precedence above; `withStatus` passes `s.seenAt`.
- [x] Write failing core tests in `src/core/sessions.test.ts`,
  `describe('core seen and notify')` (helper: start a core, create OpenCode
  sessions, `oc.emit(connected)`, `await flush()`, collect
  `core.on('notify', …)` calls):
  (1) off screen (window not focused), `exec-started` then `exec-ended` with
  `at` `'2026-10-05T09:59:00.000Z'` → `waiting`/`done` and exactly one notify
  with that session;
  (2) then `core.setWindowFocused(true)` + `uiSet({ focusedSessionId: id })`
  → `idle`, saved `seenAt` = `NOW` ISO; a second core on the same files whose
  snapshot has `idleAt` `'2026-10-05T09:59:00.000Z'` → `idle` after its first
  re-sync;
  (3) on screen (focused window, session focused), a finished turn → `idle`,
  no notify;
  (4) the first snapshot with a pending permission → `waiting` but no notify;
  a later `pending` question open on another off-screen session → one notify;
  (5) after `disconnected` and a new `connected` whose snapshot holds the same
  pending permission → no new notify; one whose snapshot adds a question to
  a previously idle session → one notify.
- [x] In `src/core/core.ts`:
  add `setWindowFocused(f: boolean): void` and the `on` overload
  `on(e: 'notify', cb: (s: Session) => void): () => void` to `Core` (keep
  `on(e: 'slice', cb: SliceListener)`); implement `on(e, cb)` with two
  listener sets. Keep `let windowFocused = false`, `let lastOnScreen: string | null = null`,
  `const waitKey = new Map<string, string>()`, `let primed = false`.
  `onScreenId()` returns `ui.focusedSessionId` when `windowFocused`,
  `ui.view === 'list'` and `!ui.focusedFeature`, else `null`.
  Rewrite `refreshStatus()`: `let next = withStatus(slices.sessions, trackers, ocConnected)`;
  `const id = onScreenId()`; if `id`, find the session in `next` (`after`) and
  in `slices.sessions` (`before`); when `after.kind === 'opencode'` and
  (`id !== lastOnScreen` or `after.status !== before?.status` or
  `after.waitingFor !== before?.waitingFor`), replace it with
  `markSeen(after, now().toISOString())` and recompute
  `next = withStatus(next, trackers, ocConnected)`; `lastOnScreen = id`;
  `if (next !== slices.sessions) set('sessions', next)`; then
  `if (ocConnected && queue === null) notifyTransitions(id)`.
  `notifyTransitions(onScreen)`: per the Notify rule over `slices.sessions`;
  sets `primed = true` at its end only when called from `resync`.
  `resync()`: after `refreshStatus()` (success) and in the `catch` branch
  (after clearing `queue` and calling `refreshStatus()`), set `primed = true`.
  `uiSet` calls `refreshStatus()` after `set('ui', next)`;
  `setWindowFocused(f)` sets `windowFocused = f` and calls `refreshStatus()`.
- [x] In `src/main/index.ts`: import `Notification`; after `createCore`, keep
  `const shown = new Set<Notification>()` and `let notifyFailed = false`;
  `core.on('notify', (s) => { … })` per the Main rule (skip when
  `!Notification.isSupported()`). On the window: `focus` →
  `core.setWindowFocused(true)` plus the existing `checkLiveness`; `blur` →
  `core.setWindowFocused(false)`; in `ready-to-show` after `show()`,
  `core.setWindowFocused(win.isFocused())`.
- [x] Run `npm test -- src/core/status.test.ts src/core/sessions.test.ts src/core/store/stateStore.test.ts`,
  then `npm test` (outside the sandbox), `npm run typecheck` and `npm run build`.
- [x] Manual (human): `npm run dev`; finish a turn in an OpenCode session
  while another is focused → its card "waiting · done", header count 1;
  click it → "idle"; restart grove → still "idle"; the `npm run dev` terminal
  shows one `notification failed` line (unsigned app, D3).

## Slice 5 — Auto-link

Context (code at `6b67b0b`, after slice 4): `src/core/opencode/normalise.ts`
holds every OpenCode shape (`normalise`, `unwrap`, `childIds`, `snapshotOf`;
local helpers `obj`, `toIso`, `ids`). `src/core/opencode/client.ts`
`HttpOpenCode.stream()` feeds each SSE frame's JSON to `normalise(raw, version)`;
`snapshot(ids)` uses a local `get(path)` (Basic headers from `this.svc`, 404 →
`null`, `unwrap`). `src/core/core.ts`: `onOcEvent` → `applyOc(e)` for
non-connection events (`child` also fills `roots`: subagent id → root id);
`resync()` runs on every `connected`, snapshots the `opencodeSessionId`s of
OpenCode sessions with `lastStatus 'running'`, and drops its result when
`syncGen` moved on. `discovery: Map<projectId, { root: string | null, folders: Map<slug, FolderSnapshot>, … }>`
holds each project's feature root (absolute, `path.resolve`d, not realpath'd);
`publish()` re-derives `features` and is called after every `sessions`
change and every discovery change. `commands.sessionLink` uses
`link(s, feature)` (sets `linkPinned: true`) from `src/core/sessions.ts`.
`FakeWatchers.roots.get(root)!(slug)` fires a folder change in tests; the
test project `p` lives in a temp dir (on macOS under `/var/folders`, a
symlink to `/private/var/folders`); `features.test.ts` `setup()` gives
`work` (`<dir>/docs/work`) and `feature(slug)`.

OpenCode 2.0.20 facts (research Q6, Q7): every tool event's `data` has
`{sessionID, assistantMessageID, id}` (`id` = the tool call id).
`session.tool.input.started` alone carries `data.name`;
`session.tool.called` carries the parsed `data.input`; then
`session.tool.success` or `session.tool.failed`. File-writing tools: `write`
and `edit` (`input.path`, relative to the session directory = the project
path, or absolute) and `patch` (`input.patchText`; paths only on lines
`*** Add File: <p>`, `*** Update File: <p>`, `*** Delete File: <p>`,
`*** Move to: <p>`). `read` also has `input.path`, so the name is needed.
`GET /api/session/:id/message?limit=200` → `{data: Message[], cursor: {next?}}`,
newest first by default; the next page is `?cursor=<next>&limit=200` (no
`order` with a cursor); an empty page is the end. An assistant message has
`content[]` with tool items `{type: 'tool', id, name, state}`; a completed
`state` is `{input, content[], metadata?}`, an errored one has `error`,
running/streaming ones have no `content` (so: completed = `state` has a
`content` array and no `error` key, or `state.status === 'completed'`).

Rules (design D2, flow *Auto-link*, rows Link source, Link matching,
Subagents; E-D6):
- `slugFor(paths, projectPath, featureRoot)`: `featureRoot` null → null.
  Each path: absolute as is, else resolved against `projectPath`; both it and
  `featureRoot` go through a best-effort realpath (realpath the nearest
  existing ancestor, re-append the rest). The path must be inside the root
  with at least two segments below it (`<slug>/<file…>`); the slug must not
  start with `.`. The last matching path wins (a patch's `Move to` comes
  after its source).
- A `wrote` event's session id maps to its root (`roots`), then to the grove
  session with that `opencodeSessionId`. Pinned (`linkPinned`) sessions are
  never changed. A slug discovery lists for that project → `feature = slug`
  (unpinned, via `autoLink`), dropping any held slug. A slug not listed yet
  → held for that session (a newer write replaces it); `publish()` applies
  held slugs once listed. A write matching no feature folder changes nothing.
- Catch-up: after each successful re-sync (same `syncGen`), for each
  snapshotted session that is unpinned, `lastWrites(opencodeSessionId)` →
  the same handling as a `wrote`. A session that got a live `wrote` since the
  re-sync began is skipped. Errors are ignored. Catch-up reads the root
  session's own messages only.

- [x] In `src/core/opencode/types.ts` add to `OcEvent`
  `| { type: 'wrote'; sessionId: string; paths: string[] } // a write/edit/patch succeeded; raw paths`
  and to `OpenCodeSource`
  `lastWrites(id: string): Promise<string[]> // paths of the session's latest successful write/edit/patch; [] if none`.
- [x] Extend `src/core/opencode/normalise.test.ts` (failing first):
  `patchPaths(text)` → the paths of all four header kinds, in order, trimmed;
  `toolWrites()` (a stateful mapper `(raw: unknown) => OcEvent | null`):
  `input.started` name `write` + `called` input `{path:'docs/x.md'}` +
  `success` → `{type:'wrote', sessionId, paths:['docs/x.md']}`; `edit` the
  same; `patch` with a `patchText` → its header paths; `read` → `null`;
  `failed` instead of `success` → `null` and the call is forgotten; a
  `success` for an unknown id → `null`; other types → `null`.
  `lastWritesOf(messages: unknown[])` (messages newest first) → the paths of
  the first completed write/edit/patch tool item scanning each message's
  `content` from the end; skips `read`, errored and running items; `null`
  when none.
- [x] Implement `patchPaths`, `toolWrites`, `lastWritesOf` in
  `src/core/opencode/normalise.ts` (a shared local
  `writePaths(name, input): string[] | null` for `write`/`edit` →
  `[input.path]`, `patch` → `patchPaths(input.patchText)`, else `null`).
- [x] Write failing test `src/core/autolink.test.ts` for
  `slugFor(paths, projectPath, featureRoot)` on a temp project with
  `docs/work/a/` and `docs/work/epic/`: relative `docs/work/a/x.md` → `a`;
  absolute → `a`; a not-yet-existing `docs/work/new/01-questions.md` → `new`;
  the project addressed through its realpath vs the `os.tmpdir()` form (one of
  them a symlink on macOS) → `a`; `src/x.ts` and `/elsewhere/x` → `null`;
  `docs/work/README.md` (directly in the root) → `null`; `docs/work/.git/x`
  → `null`; `docs/work/epic/03-design.md` → `epic`; `featureRoot` null →
  `null`; `['docs/work/a/x', 'docs/work/b/y']` → `b`.
- [x] Implement `src/core/autolink.ts`: `slugFor` and a local `real(p)`
  (`fs.realpathSync` of the nearest existing ancestor, joined with the rest).
- [x] In `src/core/sessions.ts` add
  `export function autoLink(s: Session, feature: string): Session { return { ...s, feature } } // leaves linkPinned alone`.
- [x] Write failing tests in `src/core/opencode/client.test.ts`:
  a stream sending `input.started` (write), `called` and `success` frames for
  `ses_a` emits one `wrote`; `lastWrites('ses_a')` against stub routes
  `/api/session/ses_a/message?limit=200` (a page whose only tool is a
  `read`, `cursor.next: 'c1'`) and `/api/session/ses_a/message?cursor=c1&limit=200`
  (a page with a completed `edit` of `docs/work/a/x.md`) → `['docs/work/a/x.md']`;
  an unknown session (404) → `[]`.
- [x] In `src/core/opencode/client.ts`: per `stream()` call create
  `const tools = toolWrites()` and, per frame, emit `normalise(raw, version) ?? tools(raw)`.
  Add `lastWrites(id)`: same `get` helper (factor `snapshot`'s `get` into a
  private `get(path)` method that throws `'not connected'` without `svc`);
  read up to 5 pages: `/api/session/<id>/message?limit=200`, then
  `?cursor=<encodeURIComponent(next)>&limit=200`; per page body (not
  unwrapped) `data` array and `cursor.next`; return the first
  `lastWritesOf(page)` that is not `null`; stop on 404, an empty page or no
  `next`; return `[]`.
- [x] In `src/core/testing/fakeOpenCode.ts` add
  `writes = new Map<string, string[]>()` and
  `async lastWrites(id) { return this.writes.get(id) ?? [] }`.
- [x] Write failing core tests in `src/core/features.test.ts`,
  `describe('core auto-link')` (OpenCode session created with
  `createOpenCode`, `oc.emit({type:'connected', version:'2.0.20'})`, then
  `await flush()`): (1) `wrote` `['docs/work/a/x.md']` → `feature: 'a'`,
  `linkPinned: false`, kept in `state.json`; (2) a child (`child` event) of
  the session writing into `b` → `feature: 'b'`; (3) a session pinned with
  `sessionLink` to `a` stays `a` after a `wrote` into `b`; (4) a write into
  `docs/work/new/…` before the folder exists → no link; `feature('new')`
  then `s.watchers.roots.get(s.work)!('new')` → `feature: 'new'`; (5) a
  write outside the root → no change; (6) `oc.writes` set for the session,
  then `disconnected` + `connected` + `flush()` → linked (catch-up), and a
  pinned session is not passed to catch-up (no link change).
- [x] In `src/core/core.ts`: keep `const held = new Map<string, string>()`
  (grove session id → slug) and `const wroteSince = new Set<string>()`.
  `function linkWrite(sessionId: string, paths: string[])`: session = the one
  with `opencodeSessionId === (roots.get(sessionId) ?? sessionId)`; skip if
  none or `linkPinned`; `project` by `projectId`; `slug = slugFor(paths, project.path, discovery.get(projectId)?.root ?? null)`;
  `null` → return; listed (`discovery…folders.has(slug)`) → `held.delete`, and
  if `feature !== slug` `replaceSession(autoLink(session, slug))`; else
  `held.set(session.id, slug)`. In `onOcEvent`, a `wrote` event:
  `wroteSince.add(grove session id)` then `linkWrite` (not passed to
  `applyOc`; trackers don't use it, and the queue skips it).
  `function applyHeld()`: for each held entry whose session still exists, is
  unpinned, and whose slug is now listed → delete the entry and
  `replaceSession(autoLink(…))`; entries for missing or pinned sessions are
  dropped. Call `applyHeld()` at the end of `publish()` (after
  `set('features', …)`). In `resync()`: `wroteSince.clear()` at the start;
  after the success path, `void catchUp(gen, ids)`. `async function catchUp(gen, ids)`:
  for each id, the grove session with that `opencodeSessionId`, unpinned:
  `await source.lastWrites(id)` in `try/catch`; stop if `gen !== syncGen`;
  skip if `wroteSince.has(session.id)` or no paths; else `linkWrite(id, paths)`.
- [x] Run `npm test -- src/core/autolink.test.ts src/core/opencode/normalise.test.ts src/core/features.test.ts`,
  then `npm test` (outside the sandbox), `npm run typecheck` and `npm run build`.
- [x] Manual (human): in an unlinked OpenCode session run `/grove-questions`
  on a new idea → the card shows the new feature; restart grove → link kept.

## Slice 6 — Resume

Context (code at `030e5b4`, after slice 5): `src/core/core.ts`
`commands.sessionCreate` builds `argv = loginShellArgv(['opencode', '-s', session.opencodeSessionId])`
(`src/core/env.ts`), then `backend.create({ name: session.tmuxName, cwd: project.path, cols, rows, argv })`
and `backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)`.
`sessionKill` uses `markGone` (`lastStatus: 'gone'`, `endedAt` set);
`sessionRemove` refuses `not-gone`. `resync()` (re-snapshots the live OpenCode
sessions) runs on every `connected`; `ocConnected` says whether the service
is connected. `replaceSession(next)` swaps a session by id and saves.
`backend.kill` treats a missing session as success. IPC: `InvokeMap` in
`src/shared/ipc.ts`, handlers in `src/main/ipc.ts`
(`handle('session:remove', (a) => core.commands.sessionRemove(a), true)`).
Renderer: `src/renderer/src/components/Sidebar.tsx` session row `actions`
shows a trash button when `s.lastStatus === 'gone'`; `src/renderer/src/App.tsx`
shows "Session ended" with a Remove button for a focused gone session.
`IconName` and Lucide-style `shapes` live in `src/renderer/src/components/ui/Icon.tsx`.
Tests: `src/core/sessions.test.ts` (`setupCore`, `createOpenCode`,
`createTerminal`; `fake.calls` records backend calls; `argv[4]` is the
`exec …` string).

Rules (design desired state 8, flow *Resume*, row Resume, E-D3): only a gone
OpenCode session can resume. Errors in order: unknown session or its project
→ `not-found`; not `kind 'opencode'` or no `opencodeSessionId` →
`not-opencode`; `lastStatus !== 'gone'` → `not-gone`. Resume kills any
leftover tmux session of that name (a dead pane), creates the same
`tmuxName` in the project path running `opencode -s <opencodeSessionId>`,
sets the pane colours, and sets `lastStatus: 'running'`, `endedAt: null`;
`id`, `label`, `feature`, `linkPinned`, `seenAt` stay. The tmux session
starts at 80×24 (the command takes only `{ id }`; attaching resizes it). If
the service is connected, a re-sync follows so the resumed session's status
is current.

- [x] Write failing tests in `src/core/sessions.test.ts`, `describe('resume')`:
  a gone OpenCode session (created with `createOpenCode`, linked with
  `sessionLink` to a feature folder created under `<dir>/docs/work/a`, renamed with
  `sessionRename`, then `sessionKill`) → `sessionResume({ id })` returns
  `ok` with the same `id`, `label`, `feature`, `lastStatus 'running'`,
  `endedAt null`; `fake.calls` has a `kill` then a `create` for the same
  `tmuxName` with `cwd` = the project path and `argv[4]` =
  `exec opencode -s <opencodeSessionId>`; `state.json` has it running.
  Errors: unknown id → `not-found`; a running OpenCode session → `not-gone`;
  a gone terminal → `not-opencode`. With the service connected, resuming
  adds a `snapshotCalls` entry containing its `opencodeSessionId`.
- [x] In `src/core/sessions.ts` add
  `export function resume(s: Session): Session { return { ...s, lastStatus: 'running', endedAt: null } }`.
- [x] In `src/core/core.ts` add to `Commands`
  `sessionResume(a: { id: string }): Promise<Result<Session>>` and implement
  it per the rules (reuse the `argv`/`create`/`setColors` calls of
  `sessionCreate`, `cols: 80, rows: 24`); after `replaceSession(resume(…))`
  call `if (ocConnected) void resync()`, then `refreshStatus()`; return the
  stored session.
- [x] In `src/shared/ipc.ts` add `'session:resume': [{ id: string }, Session]`;
  in `src/main/ipc.ts` add `handle('session:resume', (a) => core.commands.sessionResume(a), true)`.
- [x] In `src/renderer/src/components/ui/Icon.tsx` add `'resume'` to
  `IconName` with shape (Lucide rotate-ccw)
  `<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>`.
- [x] In `src/renderer/src/components/Sidebar.tsx`, inside the
  `s.lastStatus === 'gone'` actions, before the trash button, when
  `s.kind === 'opencode'`:
  `<Button variant="ghost" size="sm" round icon="resume" aria-label="Resume session" title="Resume" onClick={() => void window.api.invoke('session:resume', { id: s.id })} />`
  (wrap both in a fragment).
- [x] In `src/renderer/src/App.tsx` "Session ended" view, before Remove, when
  `focused.kind === 'opencode'`:
  `<Button icon="resume" variant="primary" onClick={() => void window.api.invoke('session:resume', { id: focused.id })}>Resume</Button>`;
  put both buttons in a `<div className={s.endedActions}>` and add
  `.endedActions { display: flex; gap: var(--sp-2); }` to
  `src/renderer/src/App.module.css`.
- [x] Run `npm test -- src/core/sessions.test.ts`, then `npm test` (outside
  the sandbox), `npm run typecheck` and `npm run build`.
- [x] Manual (human): `tmux -L grove kill-server` → OpenCode cards gone with
  Resume → Resume opens the TUI with its history; repeat once on a session
  interrupted mid-turn.

## Open questions
