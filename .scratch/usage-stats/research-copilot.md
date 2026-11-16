# Research: Copilot CLI usage data on disk

Source: research sub-agent, read-only, counts and field names only.

## Where

- `~/.copilot/session-state/<id>/events.jsonl` (source of truth), `workspace.yaml`, and `~/.copilot/session-store.db` (SQLite `assistant_usage_events`, lags the files: 787 rows vs 810 records; do not use).
- 38 sessions with events, about 69 MB. Only about 19 days of history exist (2026-10-22 on), no retention setting seen. Full scan 0.5 s.

## Per-request records

- `session.usage_record` is one per model request, not cumulative: `inputTokens` (includes cache), `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `model`, `initiator` (user / agent / sub-agent), `interactionType`, `copilotUsage.totalNanoAiu`, `accounting.usageId` (unique across all records), timestamp on the event envelope.
- Fresh input = `inputTokens - cacheRead - cacheWrite`. Cache is about 95% of input here.
- `session.usage_checkpoint` and `session.shutdown` are cumulative per session; never add them to record sums, and never sum shutdowns across a resume (counters carry over).
- Subagent requests live in the parent's events.jsonl and are included in session totals. Filtering them out undercounts total spend (example: 859,770 main-only vs 1,220,487 all, which equals the shutdown total).

## Correct day sum

Sum `usage_record` events by each record's own timestamp. This splits resumed sessions across days correctly. Verified: per-session record sums equal the last shutdown's model metrics.

## Premium requests

- Premium requests equal the count of records with `initiator == "user"` (36 of 36 shutdown sessions). `usage_record.cost` is a constant 1.0 and is not a premium indicator. `request_multiplier` is 1.0 everywhere.
- A newer event `model.model_call_success` carries account-level quota snapshots (entitlement, used, reset date). That is plan-limit data, out of scope.
- No record marks a request as coming from another tool.

## Folder, hour

- Folder is `cwd` from `session.start` (also `workspace.yaml`); it is fixed at start. Values seen: the repo, scratch dirs, worktrees under `~/.grove/worktrees/`, `~`.
- Requests cluster 20:00 to 22:00 local.

## In Grove or not

- Grove's own hook files `~/.grove/agents/copilot/<tab>.jsonl` carry `sessionId`; all 38 sessions here are found there (23 also in a current status.json). Older tabs whose files were removed would lose the join. Cannot tell hand-launched Copilot sessions from Grove ones unless the file is absent.

## Other editors

- VS Code, JetBrains and `~/.config/github-copilot` have no Copilot data on this machine. Copilot in other editors is not covered by anything here.

## Matrix metric (6 days only, weak evidence)

Spearman: requests vs raw input 0.94; requests vs fresh tokens 0.54. Top two days agree on every measure; they diverge below that (a day with 18 requests but almost all cache vs a day with 7 requests and more fresh tokens).
