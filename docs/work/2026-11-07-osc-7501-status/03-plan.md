---
feature: 2026-11-07-osc-7501-status
phase: plan
status: approved
version: 1
created: 2026-11-07
updated: 2026-11-07
approved_at: 2026-11-07
based_on: [01-outcome.md@1, 02-research.md@2]
forced: []
---

# Plan: agent status from OSC 7501 only

All paths are under `next/packages/`. Commands from `next/`: `npm run typecheck`, `npm test`. Commit each slice directly on master (project rule). The eight decisions in `00-ticket.md` are fixed; the decisions below are the remaining one-way doors.

## Decisions

### D1. How status leaves the holder, and who derives `finished`

**Context.** The holder parses OSC 7501 (fixed). Core today only gets `tabs.output` and `tabs.exit` from the holder, so a new channel is needed, and core can restart while the holder keeps PTYs alive. This protocol shape is hard to change later.

**Options.**
- A. Holder sends a new notification `tabs.status {id, state, kind?}` carrying the normalised root record only, and also keeps the last root record per tab and returns it as `status` on `tabs.list`. Core derives `finished` (root leaves working/blocked for idle/done) and applies the mapping. Pros: holder stays a thin parser; the reducer and `since` stay in core where they live; core restart recovers from `tabs.list`. Cons: core must see every transition, so a missed notification while core is down is only recovered as the latest state (an in-between working then idle while core was down shows as idle, not finished).
- B. Holder derives `finished` and sends the final `StatusChange` shape. Pros: core is trivial. Cons: holder gains status semantics (needs-you reasons, `since`) it does not have today; two places know the model.
- C. Core parses the raw output itself. Pros: no holder change. Cons: contradicts fixed decision 1; no status while core is down.

**Pick:** A

**Outcome impact.** Status follows the agent with no window attached and survives a core restart. A turn that finishes while core is down shows idle, not finished (no notification), which is acceptable. The missed `finished` also means no attention notification for that turn.

### D2. Core status model

**Context.** `contract.ts` has eight events fed by adapter sources, a watchdog and a cross-check. With one source the model can shrink, and the snapshot sidecar holds `{status, resumeId}`.

**Options.**
- A. Replace the events with one `report {state, kind}` event plus `session {resumeId}` (`lost` is dropped; the `alive()` reset covers it); the reducer does the mapping and the finished rule; the sidecar keeps the resume id only and status is recovered from the holder's `tabs.list`. Pros: smallest model, nothing stale on disk, no way for a restored status to disagree with the terminal. Cons: a tab restored with no live holder entry is `unknown`, never its last known status (same as today for a dead tab).
- B. Keep the old events and translate 7501 records into them. Pros: smaller diff. Cons: `heartbeat`, `idle-prompt`, `GRACE_MS`/`SILENCE_MS` survive as dead concepts against fixed decision 7.

**Pick:** A

**Outcome impact.** PTY exit and a core restart both behave as the brief says; nothing resets a tab to unknown except PTY exit or a never-reporting agent.

### D3. Resume-id source and the consent-installed hooks

**Context.** Claude has no `discover()`; its `/clear` id and a hand-started tab's id arrive only through the SessionStart hook, installed with consent (ADR 0050). Copilot and OpenCode have `discover()` for hand-started tabs but Copilot's session change within a tab arrives through hook payloads today.

**Options.**
- A. Keep a Claude-only integration whose hook is SessionStart only (no spool of status, no Stop/Notification events), keep the per-launch inline hook for Claude, and keep `hook.mjs` appending that one event to the existing jsonl spool, read by the kept generic `spool.ts` through a reduced Claude `source.ts` (the hook-to-core transport for the resume id does not change), and remove the Copilot and OpenCode integrations and hooks. Existing installed Claude entries with the old event list are replaced on the next install (state `out-of-date`). Pros: smallest surviving hook surface; matches decision 6 (id only). Cons: a Copilot session change inside one tab (not a new tab) is no longer followed; resume then uses the last known id.
- B. Keep SessionStart-style id hooks for Claude and Copilot. Pros: Copilot in-tab session changes followed. Cons: keeps a second hook system for a case not seen as needed; more surface to maintain.
- C. Write a Claude `discover()` from Claude's own session store and drop all hooks. Pros: no consent flow at all. Cons: new, unproven code and reads another tool's private files; a one-way dependency.

**Pick:** A

**Outcome impact.** The human keeps Claude resume after `/clear` and for hand-started tabs. The consent prompt and panel remain for Claude only.

## Slices

### Slice 1. Claude, Copilot and OpenCode tabs show working, idle and finished from OSC 7501

**Outcome.** A tab running any of the three agents shows working while it works and idle/finished when a turn ends, from the holder-parsed report; the old status sources no longer drive status (resume-id events still flow).
**Thin end-to-end:** agent -> PTY -> holder (`pty-table.ts` OSC handler, `?` reply) -> `tabs.status` notification -> core `StatusService` (`report` event) -> `status.changed` -> UI tab indicator. Deliberately missing: blocked/error/auth mapping, `done`, root-only filtering of `id=` records beyond ignoring them, the unknown hint, restore from `tabs.list`, deletion of old code.
**Files.** `holder/pty-table.ts` (register `term.parser.registerOscHandler(7501, …)` after the Terminal is built, write `ESC]7501;?ESC\` reply via `proc.write` for query records, keep last root record on `Tab`), `holder/server.ts` (emit `tabs.status` to every connection; the status service's own connection only makes calls today, so check how `dispatch` registers listeners per connection), `protocol/messages.ts` (notification type), `core/daemon.ts` (`holderStatusCall` gains a notification subscription that feeds the service; stop passing `screen`), `core/status/contract.ts` and `service.ts` (new `report` event; the old event types stay defined until slice 6, but the service ignores every adapter-source event except `session`, so no adapter file changes in this slice; `kind` is a plain string until slice 2 types it; `restore` marks restored tabs `unknown` instead of loading the saved status, until slice 4 recovers it from the holder; `track` now starts a launched agent tab as `unknown`; watchdog, cross-check, the `screen` option and `readWorkingScreen` removed so no timer can flip a silent tab), tests next to each.
**Verification.** `npm run typecheck && npm test` pass, including a new holder test that spawns a script printing OSC 7501 working/idle records and asserts `tabs.status` and the `?` reply bytes, and a service test for working -> idle = finished, idle -> idle stays idle, a launched tab starts unknown and a silent working tab stays working with the clock past 30s. Observable: start Claude in a Grove tab, send a prompt, see working then finished.

### Slice 2. Full mapping: needs-you reasons, error, done, `auth`

**Outcome.** blocked with kind permission|question|auth shows needs-you with that reason, blocked with no kind shows permission, error shows needs-you/error, done shows finished; records with an `id=` do not change the tab; `state=clear` and any unrecognised state leave the tab's status unchanged; the alert for `auth` reads "Needs sign-in".
**Files.** `protocol/messages.ts` and `core/status/contract.ts` (`NeedsYouReason` gains `auth`; remove the duplicate type if the contract can import it), `holder/pty-table.ts` (root vs `id=` record, parse `kind=`), `ui/alerts.ts` (`BODY.auth`), `ui/diff-model.ts` (verify no change needed), tests: `contract.test.ts`, `alerts.test.ts`, `diff-model.test.ts`, holder test.
**Verification.** A table test in `contract.test.ts` covers every row of the ticket's mapping and the finished rule, `state=clear` and an unknown state being ignored; `alerts.test.ts` asserts "Needs sign-in"; `diff-model.test.ts` asserts Send is disabled for `auth` and enabled for `error`; `npm run typecheck && npm test` pass.

### Slice 3. Unknown with a minimum-version hint

**Outcome.** An agent tab with no report stays `unknown` and its indicator tooltip names the minimum version for that agent; only PTY exit resets a tab to unknown (the timers were removed in slice 1).
**Files.** `core/status/service.ts` (drop the now-unused `graceMs`/`silenceMs` options; keep the `alive()` reset), `ui/indicator.ts` (label "no status report yet" plus the minimum version for `unknown` on a live agent tab, no hint after PTY exit, static per-agent minimums), `ui/main.ts` `indicatorEl` (sets `title` and aria-label from `indicatorLabel`, the tooltip surface) and `ui/tab-pill.ts`, tests: `service.test.ts`, `indicator.test.ts`, `tab-pill.test.ts`, `status-window.test.ts`.
**Verification.** `service.test.ts` asserts a tab missing from `alive()` goes to unknown; `indicator.test.ts` asserts the hint text per agent (Copilot 1.0.107, OpenCode 2.2.6, Claude 2.1.309); typecheck and tests pass. Observable: an agent tab running an old version shows unknown with the hint.

### Slice 4. Core restart and hand-started tabs get status from the holder

**Outcome.** After a core restart, and for an agent typed by hand into a shell, the tab's status is the holder's last root record rather than `unknown`.
**Files.** `holder/pty-table.ts` and `server.ts` (`status` on `TabInfo`/`tabs.list`), `protocol/messages.ts`, `core/status/service.ts` (`restore` and `adopt` read it only while the tab's foreground is an agent, otherwise `unknown`, so a stale last record after the agent quit is not restored; sidecar keeps resume id only), `core/daemon.ts`, tests: `holder/holder.test.ts`, `service.test.ts`, `daemon.test.ts` ("agents typed by hand").
**Verification.** `holder.test.ts` kills and restarts the core with a working fake agent and asserts the restored state is working, that a last record of `done` or an idle after a working turn restores as idle, and that a stale `working` record with a shell in the foreground restores as unknown; the typed-by-hand daemon test asserts the tab leaves unknown on the first report and that a hand-started Copilot or OpenCode tab still gets its resume id through `discover()`; typecheck and tests pass.

### Slice 5. Real-agent verification gate (error, DA ordering, OpenCode blocked)

**Outcome.** The three unverified items are checked against the real agents and the results are written into `02-research.md` (new "Verified" subsection); mapping fixes, if any, are made here.
**Files.** `02-research.md`, and mapping or ordering code in `holder/pty-table.ts` or `core/status/contract.ts` only if a fix is needed, with tests.
**Verification.** (0) For each of Claude, Copilot and OpenCode in a Grove tab, record working, finished after a turn, finished after an Esc interrupt, and needs-you/permission on a permission prompt, and the tab states shown. (1) For each of Claude, Copilot and OpenCode, run a real failure (for example an auth failure with an invalid key) in a Grove tab and record the root records seen and the shown state; `error` must show needs-you/error (or the recorded `kind` handling must be corrected and tested). (2) With the real UI attached on a slow attach (window opened while the agent starts) confirm the holder's `?` reply precedes the window's `CSI c` reply and status still arrives; also run a Claude tab with no window ever attached and confirm it reports status (Claude sends `CSI c` after the query and may wait for the reply; if it does, the holder must answer it too, which is then fixed here with a test). (3) OpenCode with a project `opencode.json` `permission` set to `ask` shows needs-you/permission. If a check cannot run unattended the run stops here for the human, and if `error` can never be produced the human decides whether to ship its mapping as recorded-unverified; slices 6-8 do not start until all three are recorded.

### Slice 6. Delete the old status sources

**Outcome.** The old status paths are gone and the app builds and passes.
**Files.** Delete `core/status/watchdog.ts` and `cross-check.ts` (+ tests; the service stopped using them in slice 1); keep `core/status/spool.ts`, used only by Claude's id source; delete `core/agents/copilot/hooks.ts`, `events.ts`, `normalise.ts`, the plugin dir and event-log code in `copilot/adapter.ts` (+ tests); delete `core/agents/opencode/hub.ts`, `normalise.ts` (+ `client.test.ts`, `normalise.test.ts`, `replay.test.ts`) and make the OpenCode adapter `watch()` a no-op; in `core/agents/claude/` reduce `source.ts` to the SessionStart -> `session` event, leave `launch.ts`, `CLAUDE_HOOK_EVENTS` and `hook.mjs` to slice 7 (`install.ts` uses the event list); remove `heartbeat`, `lost`, `idle-prompt` and the timing constants from `contract.ts`.
**Verification.** `npm run typecheck && npm test` pass; `grep -rnE "createWatchdog|createCrossCheck|createOpenCodeHub|CopilotEventLog|normaliseScreen" next/packages` returns nothing; Claude `/clear` still updates the resume id in `daemon.test.ts`.

### Slice 7. Integrations trimmed to the Claude id-only hook

**Outcome.** The consent flow installs only a Claude SessionStart hook; Copilot and OpenCode have no integration to install (Copilot keeps an uninstall-only path for entries from older installs); an old Claude install is reported out-of-date and replaced on install.
**Files.** `core/agents/claude/launch.ts` and `hook.mjs` (hook list reduced to SessionStart, `GROVE_NEXT_SPOOL` dropped in favour of the `GROVE_NEXT_HOME`/`GROVE_NEXT_TAB` fallback path), `core/integrations/install.ts`, `service.ts`, CLI `cli/args.ts` and `cli/main.ts` (`integration` agents), `protocol/messages.ts` (`IntegrationAgent`), `ui/integrations.ts` and its wiring in `ui/main.ts`, `core/daemon.ts` (`offerIntegration`, `adoptedAgentsOf`), tests: `install.test.ts`, `integrations service.test.ts`, `cli.test.ts`, `integrations.test.ts`, `integration-panel.test.ts`.
**Verification.** `install.test.ts` asserts install writes only the SessionStart entry, removes old-event entries carrying the marker, and uninstall removes it; `integration uninstall copilot` still removes marked Copilot entries (cleanup only, no install) and install rejects `copilot`/`opencode`; typecheck and tests pass.

### Slice 8. Docs and glossary

**Outcome.** The decision and the supported versions are written down.
**Files.** `docs/adr/0050-agent-hooks-installed-with-consent.md` (amended or superseded by a new ADR for OSC 7501), `CONTEXT.md` (status terms, `auth`, `unknown`), `next/README.md` (minimum versions).
**Verification.** `grep -n "7501" docs/adr/*.md CONTEXT.md next/README.md` finds the new text and the minimum versions, and `grep -n "auth\|unknown" CONTEXT.md` finds the glossary terms; `npm run typecheck && npm test` still pass.

## Reviewer round log

- Round 1 (2 blocking, 9 non-blocking). Blocking: slice 6 deleted the spool the Claude id hook needs → D3 and slice 6 now keep `spool.ts` and name the hook-to-core transport; launched tab started idle not unknown → slice 1 makes `track` start unknown and tests it. Applied non-blocking: watchdog/cross-check removal moved to slice 1; `lost` dropped in D2; `state=clear` and unknown states ignored; no-window Claude run in slice 5; Copilot uninstall-only cleanup; tooltip surface named; holder listener check; attention effect named; glossary check.
- CTO check (2 blocking). Real-agent working/finished/permission/Esc not verified → added to slice 5 (0); spool and hook survival not disclosed → listed under Deviations; hand-started resume untested → slice 4 verification.
- Round 2 (2 blocking, 7 non-blocking). Blocking: slice 1 vs 6 event-type inconsistency → slice 1 keeps old types and ignores adapter events; restore in slices 1-3 → marks tabs unknown until slice 4. Applied non-blocking: stale holder record, hint wording, CSI c conditional risk, restore of done/idle, grep symbols, launch.ts trim moved to slice 7, `kind` typing, unproducible `error`. Round 3 not run; these fixes were not re-reviewed.

## Deviations from the brief the human should know

- The brief says the spool and hooks are gone at the end. Instead the generic `spool.ts`, `hook.mjs` and a reduced Claude `source.ts` survive, carrying only the SessionStart resume id (D3); Copilot and OpenCode hooks, events and hub/normalise are deleted.
- Claude keeps a hook, narrowed to SessionStart for the resume id, because Claude has no `discover()`. "Hooks no longer mean status" still holds.
- Slice 1 leaves the old sources in the code but ignores their status events; deletion is slice 6, after the verification gate in slice 5.
- Copilot in-tab session changes are no longer followed (D3).

## Risks and what is deliberately not done

- If a Claude tab with no window waits on `CSI c`, the holder would have to answer device attributes, which duplicates the window's reply when attached. That is a protocol choice (holder always answers vs only when no window is attached); slice 5 stops for the human rather than deciding it.
- The holder's last root record can go stale when the agent quits to a shell or is killed; slice 4 restores it only while an agent is in the foreground.
- `error` is unverified for all three agents; slice 5 gates deletion. It may need a human if a real failure cannot be produced unattended.
- Real xterm.js device-attributes ordering is untested; slice 5 covers it. The headless terminal's own replies are not subscribed to, so only the window and the holder reply.
- OpenCode `blocked` was only seen with a project `opencode.json` `permission` of `ask`; users without it will see no needs-you for permissions.
- A turn that finishes while core is down shows idle, not finished (D1).
- Not done: per-terminal child records, version detection at runtime, support below the minimum versions, any fallback source.

## Open questions
