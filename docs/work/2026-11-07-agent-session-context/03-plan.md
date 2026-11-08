---
feature: 2026-11-07-agent-session-context
phase: plan
status: draft
version: 7
created: 2026-11-07
updated: 2026-11-08
based_on: [01-outcome.md@3, 02-research.md@5]
forced: []
---

# Plan: Agent session context usage

## Decisions

### D1. Require trustworthy usage for every supported agent

**Context.** Grove's `next/packages` path does not currently ingest usage metrics. Research found current context readings for Claude and Copilot. OpenCode exposes an exact latest-request snapshot; the human approved showing it with its timestamp rather than presenting it as continuously current.

**Options.**
- A. Use only provider-reported usage and known context-window capacity; do not estimate. Halt and revise if either is unavailable for an agent type. Pros: no guessed values. Cons: gaps in provider support can block completion.
- B. Estimate missing usage or capacity and label it as estimated. Pros: could cover more sessions. Cons: estimates may not reflect the provider's actual context or window.
- C. Finish with values only where both are available. Pros: partial value without misleading numbers. Cons: does not meet the request for every supported agent.

**Pick:** A. Require exact provider-reported values and a known context limit; do not estimate or finish with partial coverage.

**Human review:** Confirmed option A.

**Outcome impact.** The feature does not display fabricated counts or capacity values. Claude and Copilot show current readings; OpenCode shows the exact last-request reading and when it was measured, as confirmed in D2.

### D2. Decide whether OpenCode's last-request snapshot is acceptable

**Context.** OpenCode exposes exact input-token counts and a model context limit for the latest completed model request, not a continuously current occupancy field. Values may be stale after that request.

**Options.**
- A. Preserve the brief: require exact current context occupancy and window capacity for OpenCode; if no provider route supplies both, halt and revise rather than substitute the latest request snapshot. Pros: preserves the requested metric and D1's no-estimates choice. Cons: OpenCode may block completion.
- B. Change the OpenCode metric to the latest completed request's exact input count and model limit, labeled “last request” with its timestamp. Pros: uses provider-reported values available through its API. Cons: it is not current occupancy and may be stale after that request.
- C. Change the OpenCode metric to an estimate of active context from its messages, clearly labeled as estimated. Pros: may better reflect context after the last model request. Cons: it is not an exact provider-reported occupancy value and may differ from OpenCode's own estimate.

**Pick:** B. Use OpenCode's exact latest-request input count and model limit, visibly labeled with its timestamp.

**Human review:** Confirmed option B; the outcome brief was revised to distinguish the timestamped OpenCode snapshot from current Claude and Copilot readings.

**Outcome impact.** OpenCode usage is useful without implying it is continuously current. The label and timestamp make the measurement's age and meaning clear.

### D3. Obtain Copilot's structured context events

**Context.** The official Copilot SDK provides `currentTokens` and `tokenLimit`; Grove currently launches the interactive Copilot CLI and does not use the SDK. The reviewed documentation does not describe attaching the SDK to an existing interactive CLI session.

**Options.**
- A. Use the Copilot SDK to create/resume sessions and subscribe to `session.usage_info`; use `currentTokens`/`tokenLimit` as the metric pair. Persist each exact pair with its event time; after resume show the last saved pair with its time, or no reading until a new event arrives. Pros: documented values use the full model-window denominator and do not mix snapshot semantics. Cons: requires changing how Grove launches or owns Copilot sessions; events are ephemeral and not replayed on resume.
- B. Read context fields from the Copilot CLI custom status line. Pros: could preserve the current CLI process. Cons: the public input schema does not define the context fields or reliable Grove session attribution.
- C. Defer Copilot usage until the interactive CLI provides a documented machine-readable route. Pros: avoids changing launch behavior and avoids undocumented fields. Cons: leaves the all-agent outcome incomplete.

**Pick:** A. Use the documented SDK route; do not depend on the undocumented status-line schema.

**Outcome impact.** Copilot sessions use current values from the same documented full-window metric pair. After resume, any prior reading is clearly timestamped; without a prior reading, the UI waits for a new event rather than mixing in a different denominator.

## Slices

### Slice 1. Show an end-to-end usage measurement for Claude sessions

**Outcome.** A Claude session displays its current input-side context tokens out of the provider-reported window size.
**Thin end-to-end:** Claude `statusLine` stdin -> per-tab usage spool -> normalized context sample -> `agents.list` response -> per-session UI entry. Deliberately missing: Copilot and OpenCode measurements.
**Files.** `next/packages/core/agents/claude/launch.ts`, `next/packages/core/agents/claude/source.ts`, `next/packages/core/status/`, `next/packages/protocol/messages.ts`, `next/packages/core/daemon.ts`, `next/packages/ui/main.ts`, `next/packages/ui/sidebar-model.ts`, and focused tests. Reuse the legacy capture/normalization behavior in `src/core/claude/` where applicable, including chaining the user's existing status-line command.
**Verification.** From `next/`, run `npm test -- packages/core/agents/claude packages/core/status packages/core/daemon.test.ts packages/protocol packages/ui/sidebar-model.test.ts` and `npm run typecheck`; verify two Claude sessions with distinct `total_input_tokens` and `context_window_size` values each display their own reading. Verify null readings before the first API call and after compaction are not shown as zero.

### Slice 2. Show an end-to-end usage measurement for Copilot sessions

**Outcome.** Copilot agent sessions display the SDK's `currentTokens` out of `tokenLimit` in the shared per-session UI, paired with the event time, without changing the existing tab's prompt/response interaction.
**Files.** `next/package.json`, `next/package-lock.json`, `next/packages/core/agents/copilot/`, shared status/protocol/UI files from slice 1 as needed, and focused tests.
**Verification.** From `next/`, run `npm test -- packages/core/agents/copilot packages/core/status packages/core/daemon.test.ts packages/protocol packages/ui/sidebar-model.test.ts` and `npm run typecheck`; verify two Copilot sessions with distinct `session.usage_info` pairs keep their values and timestamps isolated. On resume, restore only the last saved exact pair with its timestamp and visibly label it “last measured,” not current; if no pair exists, show no reading until an event arrives. Do not mix `contextInfo.limit` or `promptTokenLimit` with `usage_info.currentTokens`. Verify the same persisted Copilot provider session ID remains associated with its Grove tab on resume and that the tab can still send prompts and display responses; halt and revise if the SDK route cannot preserve that interaction.

### Slice 3. Show an end-to-end usage measurement for OpenCode sessions

**Outcome.** OpenCode agent sessions display the exact input tokens from their latest completed model request out of the model's known context limit, visibly labeled “last request” with the measurement time.
**Thin end-to-end.** The OpenCode adapter's `watch({ tabId, sessionId })` reads that exact session from the authenticated shared OpenCode service: `GET /api/session/{sessionId}/context` supplies completed assistant messages and `GET /api/model` supplies the model context limit. Select the most recent completed assistant message, sum its reported `tokens.input`, `tokens.cache.read`, and `tokens.cache.write`, match its `model.providerID`/`model.id` to `/api/model`'s `providerID`/`modelID`, and pass a `ContextUsage` through the existing `onContext` path. Set `ContextUsage.at` from that message's OpenCode `time.completed`, never the local poll time. The launched/resumed session ID comes from `opencode -s <id>` and the saved tab record; hand-started tabs use the existing `discover()` result. Do not select by “latest session in this folder” once the tab has an ID.
**Protocol and UI.** Reuse `ContextUsage`, `AgentInfo.context`, and `context.changed` unchanged; `StatusService` and the daemon already route per-tab context. Pass the agent kind to `formatContext`; OpenCode rows show “Last request” with the compact token/window pair, and the title includes exact counts, model, and the completion time. No transcript or prompt content is read or displayed.
**Files.** Add `next/packages/core/agents/opencode/usage.ts` and `usage.test.ts` for the authenticated API source, response validation, per-session refresh, and timestamped sample. Change `adapter.ts` to start/close that source from `watch()` using its supplied `sessionId` and `onContext`; leave OSC 7501 status handling alone. Change `discover.ts` and `discover.test.ts` to factor the existing service registration/auth parsing for reuse without changing discovery behavior. Change `next/packages/ui/main.ts`, `sidebar-model.ts`, and `sidebar-model.test.ts` for the OpenCode label and timestamp. Add a focused notification assertion in `next/packages/core/daemon.test.ts` if needed to lock the existing `context.changed` route. `next/packages/protocol/messages.ts`, `next/packages/core/status/service.ts`, and `next/packages/core/daemon.ts` need no behavior or schema changes.
**Failure/degradation.** Poll the exact session context once per second and refresh model metadata only for a newly seen model. Before any completed request, show no reading. If token components or an exact matching known context limit are missing, invalid, or marked as a fallback, withhold/clear the reading rather than show a partial or guessed ratio. During an API outage retain only the last valid pair with its original completion time (so it remains visibly a “Last request” snapshot); at startup show nothing until the source can re-read the session. A tab with no uniquely attributable session ID gets no usage.
**Verification.** From `next/`, run `npm test -- packages/core/agents/opencode/adapter.test.ts packages/core/agents/opencode/discover.test.ts packages/core/agents/opencode/usage.test.ts packages/core/status/service.test.ts packages/core/daemon.test.ts packages/ui/sidebar-model.test.ts` and `npm run typecheck`. In `usage.test.ts`, use mocked API responses for two concurrent session IDs with distinct tokens/models/completion times; assert each reading reaches only its matching tab, uses `time.completed`, sums only the reported input/cache counts, and refuses missing or fallback limits and incomplete messages. Assert an API failure does not refresh the saved measurement time. In `sidebar-model.test.ts`, assert the OpenCode row is labeled “Last request,” includes its timestamp and does not render without a complete pair. Run a real two-session smoke test when OpenCode is available and confirm the numbers/time follow each tab's session rather than the newest session in its working directory.
**Risks.** The installed OpenCode 2.2.6 shared API and on-disk session store were checked. A live read against the running service on 2026-11-08 showed completed assistant entries carry `time.completed` and `tokens.{input,cache.read,cache.write}`, while the in-flight message carries neither; `/api/session/{id}/context` also returns session-level `compaction` and `idle` entries that must be skipped. `/api/model` listed 11 models, all with a numeric `limit.context`, and exposes no explicit “fallback” flag, so a fallback limit cannot be distinguished from provider capacity by field. The SQLite store is not used directly. Session identity for launched/resumed tabs is exact, but hand-started discovery is based on directory, time, and already-claimed IDs.

## Reviewer round log

- Round 1 (1 blocking, 0 non-blocking). Blocking: D1 and Slices 1–3 could complete without delivering usage for every agent → D1 now requires exact provider-native values for all three supported agent types, with a halt-and-revise condition for any provider gap.
- Round 2 (0 blocking, 1 non-blocking). Non-blocking: verify session-specific usage stays paired with the right session → each slice now verifies distinct values for two sessions.
- CTO check (0 blocking).
- Human review: D1 confirmed option A.
- Revision 2: provider-specific research added exact sources and limitations for all three providers; D2 and D3 surface the newly discovered OpenCode freshness behavior and Copilot SDK launch-path choice for human review.
- Round 3 (1 blocking, 2 non-blocking). Blocking: OpenCode's latest-request count is not current occupancy → D2 surfaced the difference and the human chose the exact, timestamped latest-request metric; `01-outcome.md` now states that distinction. Non-blocking: preserve Copilot session identity/interaction and test protocol mapping → Slice 2 verifies both, and Slice 1's test command includes protocol coverage.
- CTO check (1 blocking). OpenCode's documented API does not provide exact current occupancy → human chose a timestamped latest-request measurement, and the outcome was revised and confirmed.
- Human review: D2 confirmed option B; revised outcome confirmed.
- Revision review (2 blocking, 1 non-blocking). Blocking: D3 needs an explicit human choice of Copilot integration route → D3 presents the SDK, undocumented CLI status-line, and deferral options for review; `usage_info` is now the sole full-window metric pair with no mixed `contextInfo` denominator. Non-blocking: verify Copilot readings across two sessions → Slice 2 now does so.
- Copilot source clarification: `contextInfo()` can return current `totalTokens` after resume, but its `limit` is not the full model-window `usage_info.tokenLimit`; Slice 2 uses and persists only the matching event pair.
- CTO check (1 blocking). A saved Copilot event pair could appear current after resume → the outcome and Slice 2 now require the timestamped “last measured” label; the human confirmed this behavior.
- Revision review (1 blocking, 2 non-blocking). Blocking: D3's Copilot SDK launch-path choice needs human confirmation → D3 remains a human-reviewed decision. Non-blocking: verify the persisted provider session ID and OpenCode completion timestamp → Slice 2 checks the Copilot ID association, and Slice 3 uses the matching assistant `time.completed`.
- Copilot source clarification: `contextInfo()` is a current snapshot but its denominator differs from the full-window `usage_info.tokenLimit`; use the event pair for a consistent full-window ratio. OpenCode token readings can use the assistant `time.completed` mapped from the server `session.step.ended` event.
- CTO check (0 blocking). Confirmed the revised Copilot after-resume label, timestamped OpenCode snapshot, per-session isolation, and server-side completion timestamp match the brief.
- Human review: D3 confirmed option A (use the documented Copilot SDK route).
- Human review: no veto; D2 and D3 retained.
- Slice 3 revision (2026-11-08): after merging master `b0969be` (OSC 7501, ADR 0053) the planned `opencode/hub.ts` and `opencode/normalise.ts` no longer exist, so slice 3 was rewritten against the live shared OpenCode API. Status returned to draft; two questions now block re-approval, and D3 still needs the Copilot route decision from the follow-up research.

## Deviations from the brief the human should know

OpenCode's value is a timestamped snapshot from the latest completed model request, not continuously current occupancy; this distinction is part of the confirmed brief.

## Risks and what is deliberately not done

- `next/packages` currently ingests no provider context metrics. Claude has a usable status-line source, Copilot has a documented SDK route that may require changing the launch architecture, and OpenCode supplies only the latest completed request's input usage plus model capacity. These provider semantics are not identical.
- Copilot SDK context events are ephemeral and not replayed after resume. Reuse a locally saved exact event pair with its timestamp, or show no reading until a new event arrives; do not substitute `contextInfo`'s different denominator.
- OpenCode model metadata may contain fallback limits for unknown models. Do not present fallback capacity as verified provider capacity.
- The last-request OpenCode snapshot or an estimated value can only be used if the human explicitly changes the outcome; neither may be silently substituted for current occupancy.
- The plan does not add prompt/transcript views, other context metrics, or controls for managing a session's context.

## Open questions

- `discover()` chooses the earliest unclaimed eligible session when more than one session matches a hand-started OpenCode tab's directory/time. Should an ambiguous match suppress usage until the session can be identified, or is the existing deterministic discovery rule acceptable for a metric that must not be attributed to the wrong tab?
- Can the OpenCode API distinguish a provider/model-reported context limit from its fallback limit for unknown models? The live catalog exposes `limit.context` with no fallback flag. If it cannot, D1's no-fallback requirement blocks a verified OpenCode reading; the human must choose whether to revise D1 or leave the reading unavailable. Do not silently treat the fallback as provider capacity.
- D3 (Copilot SDK) remains unresolved: the SDK cannot attach to Grove's running interactive `copilot` CLI. The follow-up research presents SDK-owned sessions, JSONL tailing, a status-line probe, PTY scraping, and deferral; the human must choose the route before slice 2 is re-planned.
