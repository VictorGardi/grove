---
feature: 2026-11-07-agent-session-context
phase: research
status: approved
version: 5
created: 2026-11-07
updated: 2026-11-07
approved_at: 2026-11-07
based_on: []
forced: []
repo_heads:
  - ab7b547a4aaf64c3c0b71d1de6265e709d1a8e42
---

# Research: Agent session context

## Current behavior

### Agent identity and stored data

- Agent kinds are `claude`, `opencode`, and `copilot`; each has an adapter registered in `next/packages/core/agents/registry.ts`.
- Grove associates agent tabs with a tab ID, agent kind, and agent-specific session ID. Launch and resume behavior lives in the respective agent adapter/launch files. `next/packages/core/presence.ts` can also discover agents typed into shell tabs.
- `next/packages/core/store/state.ts` persists `agent` and `agentSessionId` in each `TabRecord`. Status sidecars persist status and resume ID; hook spool offsets are also persisted.
- Agent adapters normalize hook/service events into status events. The shared `next/packages/core/status/contract.ts` represents working, needs-you, finished, idle, and unknown states, plus control events. It has no prompt or transcript event.
- Claude and Copilot hooks spool JSON event payloads, and OpenCode reads session state/events. The adapters use these sources for agent status, not to expose the conversation transcript as Grove session context.
- No provider currently has a parsed, persisted, or exposed token-usage or context-window-capacity metric in `next/packages/core`.
- `next/packages/core/status/cross-check.ts` recognizes and strips terminal-screen counters such as `↑ 1.2k tokens`; it does not retain them as usage.

### Provider-specific metric sources

#### Claude Code

- Claude Code's documented machine-readable route is a custom `statusLine` command. It receives JSON on stdin containing `session_id` and `context_window` fields, including `total_input_tokens`, `context_window_size`, `used_percentage`, and `current_usage`.
- `total_input_tokens` is the current input-side context occupancy, including cache reads and writes. `current_usage` provides `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`; the documented used percentage excludes output tokens. The window size must be read from `context_window_size`, not hard-coded.
- The status-line command runs at session start/resume and on events including assistant messages and compaction completion, with a 300 ms debounce. `current_usage` can be null before the first API call and after compaction until the next API call; a periodic refresh reruns the command but does not refresh the underlying usage.
- Grove's legacy `src/core/claude/hooks.ts` already adds a `statusLine` capture command, retains model/window/percentage/input/cache counts in its spool, and chains the user's configured status-line command. `src/core/claude/normalise.ts` sums input plus cache read/write as context usage; associated tests cover the value and null readings.
- This legacy capture drops Claude's `session_id` from each status-line record. The current `next/packages/core/agents/claude/launch.ts` configures lifecycle hooks only; `next/packages/core/agents/claude/source.ts` has no context event and does not ingest status-line data.
- Sources: [Claude Code status-line setup and fields](https://code.claude.com/docs/en/statusline), [status-line update behavior](https://code.claude.com/docs/en/statusline#how-status-lines-work), [Grove legacy capture](../../../src/core/claude/hooks.ts), [legacy normalization](../../../src/core/claude/normalise.ts).

#### GitHub Copilot CLI

- The official Copilot SDK exposes live `session.usage_info` events. `data.currentTokens` is current context occupancy and `data.tokenLimit` is the model context-window size. The event is ephemeral, emitted as context size changes, and is not replayed after resume.
- The SDK also exposes `session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 })`, an on-demand current-context snapshot after resume. It returns `contextInfo.totalTokens`, `limit`, and `promptTokenLimit` (among breakdown fields); `contextInfo` can be null until initialized. `totalTokens` counts system-prompt, conversation, and tool-definition tokens.
- `contextInfo.limit` is the selected context tier's advertised prompt allowance and the context-display denominator; `promptTokenLimit` is the effective input budget after reserving requested output. Neither is documented as equivalent to `usage_info.tokenLimit`, which is the model's full context-window capacity. The snapshot route does not return a `tokenLimit` field.
- For a consistent ratio against the full model context window, use the `usage_info.currentTokens` / `usage_info.tokenLimit` pair. Because the event is ephemeral and not replayed after resume, a new full-window reading is unavailable until an event arrives; a prior locally saved pair can only be shown as its last-measured value.
- `assistant.usage` and accumulated session metrics are per-call or cumulative consumption, not current context occupancy.
- Copilot CLI's `/context` and `/usage` are interactive displays without a documented machine-readable output contract. Its custom `statusLine` command receives session JSON and changelog notes context-window fields, but public docs do not name/type those fields or establish a Grove session-ID mapping. CLI hooks do not include context occupancy/capacity.
- Grove's current integration launches the interactive CLI and captures lifecycle/tool hooks. It does not use the Copilot SDK. The SDK supports creating/resuming sessions by session ID, but the reviewed sources do not document attaching an SDK client to an already-running interactive CLI process; switching to the SDK route changes Grove's current launch architecture.
- Sources: [Copilot SDK usage and context window](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing#context-window-utilization), [SDK context snapshot](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing#on-demand-breakdown-with-sessionmetadatacontextinfo), [SDK context snapshot field definitions](https://github.com/github/copilot-sdk/blob/d1e6021a43b26e87acfcd43b37988eff09dd8aaf/nodejs/src/generated/rpc.ts#L5558-L5607), [Copilot SDK event types](https://github.com/github/copilot-sdk/blob/d1e6021a43b26e87acfcd43b37988eff09dd8aaf/nodejs/src/generated/session-events.ts#L4807-L4875), [Copilot CLI config reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference.md).

#### OpenCode

- OpenCode's server API provides `GET /api/session/{sessionID}/context`, returning active context messages after compaction. The latest assistant message may carry `tokens.input`, `tokens.cache.read`, and `tokens.cache.write`; their sum is the provider-reported prompt input for that completed model request. It is not a cumulative session total or a continuously current occupancy value. Values are optional and update at step completion.
- `GET /api/model` exposes model metadata including `limit.context`; match the latest assistant message's `providerID` and model ID. Unknown models may use OpenCode's fallback limits, so a fallback is not proof of the provider's actual capacity.
- The server's `session.step.ended` event carries request token data and can trigger a refresh. OpenCode's internal compaction estimator estimates active context beyond the last measured assistant step, but the reviewed session-context endpoint does not expose that computed estimate.
- The assistant message has `time.created`, optional `time.streamed`, optional `time.completed`, and optional `tokens`. The `session.step.ended` event envelope has `created`, but its data has no separate measurement-time field. OpenCode's message projection sets `assistant.time.completed` and `assistant.tokens` from that event's `created` and `data.tokens`; use this OpenCode server-side completion time, not a local poll/receipt time or a provider-supplied timestamp.
- Grove's OpenCode hub already connects to the registered service, knows the session ID, and listens to `/api/event`; it currently resynchronizes only status, permissions, and forms. A context endpoint and model lookup could provide a precise *last-request snapshot* with a freshness timestamp, but not an exact live count between completed requests.
- Sources: [OpenCode session context route](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/protocol/src/groups/session.ts#L502-L511), [assistant usage and time schema](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/schema/src/session-message.ts#L220-L246), [step-ended event](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/schema/src/session-event.ts#L360-L375), [event envelope timestamp](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/schema/src/event.ts#L65-L74), [token/time projection](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/core/src/session/message-updater.ts#L263-L276), [model limit metadata](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/schema/src/model.ts#L106-L155), [internal context estimator](https://github.com/anomalyco/opencode/blob/c33eaa170ed5093c08f1684862a695aae036dcda/packages/core/src/session/compaction.ts#L1126-L1152).

## Research conclusion

- **Claude Code:** Both occupancy and context-window capacity are available as structured status-line input. Grove already captures them in `src/core/claude`, but the `next/packages` path does not.
- **Copilot:** The SDK provides current occupancy and full-window capacity via `session.usage_info`; its separate on-demand snapshot has a different denominator. Grove's current interactive CLI path does not consume the SDK, and its custom status-line input has no public field schema.
- **OpenCode:** The server API provides exact prompt-token counts for the latest completed model request and a model context limit. It does not expose a continuously current occupancy field; values can be stale after the last model request.
- These values are not interchangeable as a continuous live gauge. Claude and Copilot report current context snapshots, while OpenCode's confirmed API route reports the last completed request's input and capacity metadata.

### Protocol and CLI

- `next/packages/protocol/messages.ts` defines `AgentInfo` with tab ID, agent, state, optional reason, timestamp, source, and resumability. `agents.list` returns these summaries.
- `tabs.create` accepts an agent kind and optional resume ID. `tabs.screen` returns terminal screen text. No protocol method returns a session transcript or structured conversation context.
- The CLI `ls` combines space/tab information and agent status, `read` returns the current terminal screen, and `wait` watches status. There is no session-context CLI command (`next/packages/cli/args.ts`, `main.ts`).

### UI

- `next/packages/ui/main.ts` restores terminal screens, renders tabs and pane headers, loads `agents.list`, and updates agent state from `status.changed`.
- The Agents sidebar (`index.html`, `main.ts`, `sidebar-model.ts`) displays agent kind, tab name, status, elapsed time, and a Resume button when available. It retains reason/source in state but does not render them in the row.
- The dock currently provides Notes and Changes modules (`dock-modules.ts`). The Changes panel is tied to the active tab and shows diff/review information; there is no separate agent session-context/history panel.
- The UI bridge (`bridge.ts`) invokes RPC and dispatches notifications; no context/transcript RPC consumer exists in the UI.

## Relevant files and tests

- Core/session state: `next/packages/core/agents/registry.ts`, agent adapters and discovery modules under `next/packages/core/agents/`, `next/packages/core/presence.ts`, `next/packages/core/status/adapter.ts`, `next/packages/core/status/contract.ts`, `next/packages/core/status/service.ts`, and `next/packages/core/store/state.ts`.
- Protocol and CLI: `next/packages/protocol/messages.ts`, `next/packages/protocol/client.ts`, `next/packages/core/daemon.ts`, `next/packages/cli/args.ts`, and `next/packages/cli/main.ts`.
- UI: `next/packages/ui/main.ts`, `next/packages/ui/index.html`, `next/packages/ui/bridge.ts`, `next/packages/ui/sidebar-model.ts`, `next/packages/ui/dock.ts`, and `next/packages/ui/dock-modules.ts`.
- Relevant existing coverage includes core daemon, presence, status, store, agent adapter/source/discovery tests; protocol framing and CLI tests; and UI bridge, sidebar-model, modules, diff-panel, and notes-panel tests.

## Project commands

Run from `next/`:

- `npm test -- <vitest file or directory selectors>` for targeted tests.
- `npm run typecheck` for TypeScript checking.
- `npm test` for the full Vitest suite.

## Open questions
