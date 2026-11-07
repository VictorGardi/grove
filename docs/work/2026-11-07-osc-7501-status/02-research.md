---
feature: 2026-11-07-osc-7501-status
phase: research
status: approved
version: 2
created: 2026-11-07
updated: 2026-11-07
approved_at: 2026-11-07
based_on: []
forced: []
repo_heads:
  - ab7b547
---

# Research: OSC 7501 as the only agent status source

The spike finding comes first, then the code map of v2 (`next/`) as of `ab7b547`. Paths are under `next/packages/`.

## Spikes

### Can the holder parse OSC 7501 and answer the `?` query so Claude, Copilot and OpenCode report status end to end?

**Question.** Can the holder's headless xterm (`packages/holder/pty-table.ts`, `@xterm/headless` 6.0.0) parse OSC 7501 and answer `ESC]7501;?ESC\` so Claude 2.1.309, Copilot 1.0.107 and OpenCode 2.2.6 all report status? Also OpenCode `blocked` and an `error` case. (30-minute time box.)

**Answer.** Yes for working, idle and blocked. A throwaway probe wired `node-pty` to `@xterm/headless` as the holder does, registered `term.parser.registerOscHandler(7501, …)`, wrote the `?` reply into the PTY, and read root records only. All three agents reported through it. `error` was not shown: inconclusive within the time box.

- Claude only reports after the terminal answers the query; it sent `ESC]7501;?` and then `CSI c`.
- Copilot sends no query and needs 1.0.107 or newer; 1.0.106 sent only `idle`.
- OpenCode sends the query but reports without a reply. It never sends `done`; a finished turn is `working` then `idle`. It needs 2.2.6 or newer (2.0.20 sent nothing).
- An Esc interrupt is `idle` for all three. Copilot and OpenCode send `working` then `idle` at the same instant.

**Evidence.** Root records with timestamps, the UI's device-attributes reply simulated after the holder's reply:

| Agent | Records seen |
|---|---|
| Claude | query replied 0.8s; `idle` 0.9s; `working` 15.0s; `blocked kind=permission` 17.5s; `idle` after Esc 40.1s |
| Copilot | `idle` 0.7s; `working` 15.0s; `blocked kind=permission` 17.9s; `working`+`idle` after Esc 40.1s |
| OpenCode | query replied 0.2s; `idle` 1.2s; `working` 15.1s; `blocked kind=permission` 17.1s (only with a project `opencode.json` setting `permission` to `ask`; the `OPENCODE_CONFIG_CONTENT` env var had no effect); `working`+`idle` after Esc 40.1s |

Claude's `blocked` record carries `msg=` (base64). OpenCode also sends per-session records (`id=ses_…`, `title=`) and `state=clear`; Claude and Copilot send root records only. `error`: Claude against a dead endpoint was still retrying (10 attempts) after 25s; OpenCode ignored `-m` and a bad `model` in config. Not tested: the real holder together with a real xterm.js reply.

**Recommendation.** Parse in the holder, as herdr-core parses in its runtime. Treat `error` as unproven and verify it on a real failure (for example an auth failure) before deleting the old status paths. Derive `finished` from the root leaving `working` or `blocked` for `idle` or `done`, since OpenCode never sends `done`. Write the query reply before any device-attributes reply.

## Code map (today)

Commands (from `next/`): `npm run typecheck`, `npm test` (vitest, `packages/**/*.test.ts`), single file `npx vitest run <path>`. No lint script.

### Holder (`holder/`)

- `pty-table.ts`: one headless `Terminal` (`@xterm/headless` 6.0.0, `allowProposedApi: true`) per tab, built at L88-90 with `SerializeAddon`. `proc.onData` (L105-109) does `term.write(data)` then `listener.onOutput(data)`. The terminal is used for `serialize` (attach), `screen()` (text rows, feeds `tabs.screen`) and `resize`. No `term.parser` use anywhere; nothing subscribes to the headless `term.onData`, so its own device-attributes replies go nowhere. `Tab` interface L46-56; `PtyTable.write(id, data)` L155; `tab.proc.write` is in scope in `create`.
- `server.ts` `dispatch` (L138-188): methods `core.ping`, `tabs.create|list|write|resize|kill|attach|screen`; the only notifications are `tabs.output` and `tabs.exit`. No status message exists.
- `bin.ts` supervises the core. Tests: `pty-table.test.ts`, `attach.test.ts`, `holder.test.ts`.
- The UI's xterm.js (`ui/terminal.ts`, `@xterm/xterm` 6.0.0) registers no parser handlers; it answers `CSI c` itself and the reply goes `term.onData` -> `tabs.write` -> PTY, only while `tab.attached` (`ui/main.ts:386`). Replay of the serialized screen on attach has no reply filtering.

### Core status (`core/status/`, `core/agents/`)

- `contract.ts`: `Status` (working | needs-you{reason permission|question|error} | finished | idle | unknown, each with `since`), `StatusEvent` (working, needs-you, finished, idle, idle-prompt, session{resumeId}, heartbeat, lost), pure reducer `applyEvent` (L49-69), `GRACE_MS=3000`, `SILENCE_MS=30000`, `TimingOptions`. Tests: `contract.test.ts`.
- `service.ts` (`StatusService`, 421 lines): one `Watch` per agent tab (cross-check, watchdog, adapter source). Options: home, adapters, screen(), alive(), onSession, clock, tickMs, graceMs, silenceMs; production passes only home, adapters, screen, alive, onSession (`daemon.ts` L112-118). `restore` (L82; a tab not alive restores as unknown), `adopt` (L114, hand-started tabs start unknown), `identify` (L131), `track` (L154, launched tab starts idle), `tick` (L176: `alive()` per tick, missing tab -> unknown; this is the existing PTY-exit reset; then screen read, watchdog, cross-check), `list`, `markSeen` (finished -> idle), snapshot sidecar `<home>/agents/<kind>/<tab>.status.json` = `{status, resumeId}`, `apply` emits `StatusChange`.
- `watchdog.ts` (used only by `service.ts`), `cross-check.ts` (+ `normaliseScreen`, also used by `readWorkingScreen`), `spool.ts` (generic jsonl tail with offset file, fs.watch + 1s poll as heartbeat). Tests: `watchdog.test.ts`, `cross-check.test.ts`, `service.test.ts` (547 lines).
- `adapter.ts`: `AgentKind` ('claude'|'opencode'|'copilot', imported widely), `AgentAdapter` {kind, needsSession?, discover?, launch, watch, available?}. `agents/registry.ts` holds the three adapters; `commandOnPath.ts` is the PATH probe.
- Claude: `launch.ts` (`--session-id`/`--resume`, inline `--settings` hooks via `claudeSettings`, `GROVE_NEXT_SPOOL`, per-launch hooks omitted when user hooks are installed), `hook.mjs` (appends `{event, at, payload}` to the spool), `source.ts` (`eventsFor`: SessionStart `payload.session_id` -> `session` event = the /clear resume-id path), `adapter.ts`. Claude has no `discover()`; a hand-started Claude gets its id only from the first SessionStart hook, which needs the user-installed hooks.
- Copilot: `adapter.ts` (per-launch plugin dir with hooks, spool source + `CopilotEventLog` poll + fold), `hooks.ts`, `events.ts`, `normalise.ts`, `discover.ts` (`findCopilotSession` by cwd and created_at in `<COPILOT_HOME>/session-state`). `discover` also works for hand-started tabs.
- OpenCode: `adapter.ts` (`needsSession: true`, `opencode -s <id>`), `hub.ts` (shared SSE to the OpenCode service), `normalise.ts`, `discover.ts` (`/api/session`, earliest session in cwd since `since`).
- Presence (`core/presence.ts`): each tick a live tab whose foreground/argv0 is claude|opencode|copilot is adopted (`adopt(tabId, kind, '')`) and put in `awaitingId`; `discover(kind, cwd, seenAt-2000ms, exclude)` then `identify`. Adopted tabs are released after 3 ticks without the agent.
- `daemon.ts`: status service built at L92-118 with its own holder connection (`tabs.screen`, `tabs.list`, 2000ms timeout); `status.subscribe` broadcasts `status.changed` and calls `attention.onStatus` (L209-219); `onSession` -> `spaces.setAgentSession` -> `TabRecord.agentSessionId`; `createAgentTab` (L460-545) resolves the resume id, launches via the adapter, `status.track`. The daemon does not listen to `tabs.exit`; the reset is the service tick via `alive()`.
- Integrations (`core/integrations/`): `install.ts` edits `~/.claude/settings.json` and `~/.copilot/settings.json` (marker `# grove-next-hook`), `service.ts` (consent file), CLI `integration <install|uninstall> <agent>`, UI panel (`ui/integrations.ts`), RPCs `integration.status|install|uninstall|answer`, notification `integration.prompt`; `IntegrationInfo` states enabled | not-enabled | out-of-date | unreadable. ADR `docs/adr/0050-agent-hooks-installed-with-consent.md`.
- `attention/attention.ts` consumes only `StatusChange` (state, reason); source-agnostic.

### Protocol and UI

- `protocol/messages.ts`: `AgentStateName` L133, `NeedsYouReason` L135 (duplicated in `core/status/contract.ts:15`), `AgentInfo` L137-145 (`source` is only the agent kind), `StatusChange` L203-210, `AttentionNotice`, `TabInfo` L93-104 (no version field). No minimum-version concept exists anywhere (grep for `minVersion`, `semver`, `--version`).
- `protocol/rollup.ts`: `URGENCY` = needs-you, working, finished, unknown, idle.
- `ui/alerts.ts`: `BODY` maps reasons to "Needs permission" / "Has a question" / "Hit an error"; `noticeBody`. `ui/diff-model.ts` `sendState` (L301-311) disables Send for a non-error needs-you reason ("<agent> is waiting for an answer"). `ui/indicator.ts` is the single source of state labels (`unknown` included); used by `tab-pill.ts` and `main.ts indicatorEl` (L331). `ui/sidebar-model.ts` `tabStateOf` (L15): a non-shell tab without status is `unknown`. `status.changed` handler `ui/main.ts:1163-1179`. Reasons are not rendered in the sidebar or pills, only in notification bodies, Send gating and the diff target. Status surfaces carry no cause for `unknown` and no version data.
- Tests touching status: `contract`, `service`, `watchdog`, `cross-check`, per-agent `adapter/source/replay/normalise/hooks/events/client`, `daemon`, `presence`, `attention`, `install`, `integrations service`, `cli`, `wait`, `rollup`, `alerts`, `indicator`, `tab-pill`, `sidebar-model`, `diff-model`, `status-window`, `integrations`, `integration-panel`, `demo/states`.

### Facts relevant to the ticket's decisions

- Items deleted with decision 7 and 8, by file, are the ones listed above (`watchdog`, `cross-check`, `spool`, Claude `source`/`hook.mjs` status parts, Copilot `hooks/events/normalise`, OpenCode `hub/normalise`, status parts of `service.ts` and `contract.ts`).
- Decision 6 collides with a fact: Claude's resume id after `/clear` and for hand-started tabs arrives only via the SessionStart hook, and Copilot/OpenCode have `discover()` but no id for a changed session. The minimal id source for Claude therefore stays a hook (SessionStart only) with its consent-installed integration; for Copilot and OpenCode `discover()` already covers hand-started tabs.
- OSC 7501 records are per-tab in the holder; core currently has no push channel from the holder (only `tabs.output`/`tabs.exit`), so a new holder notification is needed.

## Unverified, carried into the plan as slices

- Does `error` arrive for each agent on a real failure, and with which `kind`?
- Does the real xterm.js device-attributes reply ever beat the holder's `?` reply on a slow attach?

## Open questions

## Correction (found after slice 4)

Records separate fields with `:`, not `;`, e.g. `state=working:app=claude-code`, `state=done:app=claude-code:msg=<base64>`, `state=working:id=ses_x:app=opencode:title=<base64>` (`id=` can sit anywhere, not only last). Seen on real Claude 2.1.309, Copilot 1.0.107 and OpenCode 2.2.6. Slices 1-4 split on `;` and so never recognised a real record; fixed on master.

## Verified (slice 5)

Claude 2.1.309, one tab driven with `next/bin/grove-next` against the live dev app: `unknown` → `idle` → `working` → `finished` → `idle` observed by the agent.

The human then ran the remaining checks by hand and reported "all of it works perfectly": (0) working, finished, finished after Esc, and needs-you/permission for Claude, Copilot and OpenCode; (1) a real failure for each agent showing needs-you/error; (2) late window attach with the holder's `?` reply first, and a Claude tab with no window attached reporting status; (3) OpenCode with `permission: ask` showing needs-you/permission. These are the human's report; the individual root records and states were not captured, and no mapping or ordering fix was needed.
