# 0016. Claude Code status and writes from per-session hook spool files

Date: 2026-10-06

## Status

Accepted

## Context

Claude Code becomes a second agent kind next to OpenCode (epic v6, child 10).
Unlike OpenCode (ADR 0005) it has no shared service with an event stream. Its
documented extension point is hooks: per-event commands (JSON on stdin) or
HTTP POSTs, which can be supplied per launch with `claude --settings <json>`
and merge with the user's own hooks. Its transcript JSONL is documented as
internal and changing between versions, and `~/.claude/sessions/<pid>.json`
is undocumented. Status needs working, waiting (permission or question),
finished turn and file writes, and must catch up after an app restart.

## Decision

Every Claude Code session is launched with `--settings` hooks whose command
appends the hook's JSON input as one line to an app-owned spool file,
`<userData>/agents/claude/<sessionId>.jsonl`. Main watches and tails the
spool; a Claude adapter maps hook events to the same agent-neutral status and
write events the OpenCode adapter emits. On start, re-sync and link catch-up
replay the spool. A spike verifies the hook payloads; a failure reopens this
decision rather than being worked around.

## Consequences

- No local listener or port; events keep being recorded while the app is
  closed, so catch-up never parses the transcript.
- Spool files grow and are truncated or deleted when the session is removed.
- Status follows file-watch latency (tens of ms).
- `Stop` does not fire on a user interrupt; the adapter must cope with a turn
  that ends without it.
- Rejected: `http` hooks to a loopback server in main (first listener, events
  lost while the app is closed, transcript needed for catch-up, unknown
  behaviour when the endpoint is down); polling `~/.claude/sessions/<pid>.json`
  and tailing the transcript (undocumented or declared unstable, pid mapping,
  permission vs question not distinguishable).
