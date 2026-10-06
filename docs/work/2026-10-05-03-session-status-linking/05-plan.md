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

## Open questions
