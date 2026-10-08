# 0032. Context gauge from Claude Code's statusLine

Date: 2026-10-07

## Status

Accepted

## Context

The grid and session headers show how much of the context window a Claude
session has used. The window is 200k or 1M depending on the account and a
model setting, so it can't be inferred from the model name or the transcript.
Claude Code reports `context_window` (size, `used_percentage`, `current_usage`)
and `model` only to a `statusLine` command. A `statusLine` in the per-launch
`--settings` JSON overrides the user's own (checked with claude 2.1.285), so
grove's would replace theirs.

## Decision

`hookSettings()` adds a `statusLine` command. It appends a slim `StatusLine`
record (model id, window size, used percentage, the three input token counts) to
the session's spool (ADR 0016), then runs the user's own statusLine command
from `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json` on the same stdin and
prints its output. The Claude fold keeps the latest reading and emits an
agent-neutral `context` event (ADR 0019); trackers and snapshots carry it to
core, which sets live-only `contextPct`, `contextTokens`, `contextWindow`
and `model` on the session. One persisted field, `lastContext`, keeps the last
reading with a known percentage so an ended session still shows one
(`state.json` schemaVersion 5, v4 → v5 sets it to null).

## Consequences

- Needs `jq`; without it the command does nothing, so no gauge and no user
  statusline either. Only the user-level statusLine is chained, not a project one.
- The percentage is Claude's own `used_percentage`; null early in a session and
  after /compact, shown as "—".
- The spool gains a record per statusline refresh (about one per message).
- Rejected: reading the transcript for usage (internal format, no window size);
  inferring the window from the model name (wrong for 1M-enabled sessions).
