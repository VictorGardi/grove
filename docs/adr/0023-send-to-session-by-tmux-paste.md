# 0023. Text is sent to a session by tmux bracketed paste plus Enter

Date: 2026-10-07

## Status

Accepted

## Context

Review comments must send several comments to a session as one message. The
Grove CLI must also send text to any session. Until now the only way to put
input into a session was the single attach pty, which only exists while that
session is on screen. OpenCode's server offers an experimental
`POST /api/session/{id}/prompt`, but it is unknown whether a TUI attached to
the session shows a prompt posted that way. Claude Code offers no outside
input channel for a running interactive session.

## Decision

Core sends text to a session with
`tmux set-buffer` → `paste-buffer -p -d` (bracketed paste) → about 150 ms
pause → `send-keys Enter`, through new backend methods `paste` and `capture`.
`sendToSession(id, text)` is the single core command for it. It works the
same for OpenCode, Claude and terminal sessions. A gone agent session is
resumed first, and the paste waits until the pane's captured text has been
stable for 1 s (20 s timeout).

## Consequences

- One agent-neutral path, reused by review comments and the Grove CLI. It
  needs no attach and no agent API.
- No delivery acknowledgment: success means tmux accepted the paste. Text
  merges with anything the human has half-typed in that composer.
- On 2026-10-07 a check found that both TUIs take a multi-line bracketed
  paste as one paste block (Claude Code 2.1.285, OpenCode 2.0.20).
- Rejected: OpenCode's prompt API (experimental, a second path, unknown TUI
  behaviour); `send-keys -l` typing (newlines submit early).
