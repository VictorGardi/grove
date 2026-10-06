---
feature: 2026-10-05-03-session-status-linking
phase: plan
status: approved
version: 1
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

## Open questions
