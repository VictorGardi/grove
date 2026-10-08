# 0003. tmux on a dedicated socket as the session backend

Date: 2026-10-05

## Status

Accepted

## Context

Sessions (OpenCode TUIs and plain terminals) must survive the app closing and be
re-attachable in xterm.js. The ticket preferred herdr with tmux as fallback,
pending Phase 0 spikes. Research found tmux 3.6b installed and the exact
pattern (detached session + node-pty `tmux attach`) proven by both the previous
grove app and Xirp. herdr is not installed, is v0.9.3, and its external stream
may be re-rendered frames rather than raw PTY bytes.

## Decision

Sessions run in tmux on a dedicated socket (`tmux -L grove`) with an
app-shipped config file (`-f`), one tmux session per app session named
`grove-<uuid>`, attached through node-pty. The config sets `mouse on`,
`status off`, `history-limit 50000`, `allow-passthrough on`,
`remain-on-exit failed`; the session env sets `COLORTERM=truecolor`. The backend
sits behind the `SessionBackend` adapter; herdr is a stub. Phase 0 verifies
this choice; a blocker reopens the decision.

## Consequences

- No new infrastructure; grove's sessions are isolated from the user's own tmux
  sessions and `~/.tmux.conf`.
- tmux is a second terminal emulator between the program and xterm.js: the
  app must handle OSC 10/11 colour queries and replay mouse mode on reattach
  (as Xirp does).
- Sessions survive app quits but not a reboot or tmux server kill; OpenCode
  sessions are then resumable by id (`opencode -s <id>`).
- Rejected: herdr (unobserved, young, possible double emulation, external
  daemon, go/no-go risk to the appetite); an own PTY daemon (about a week of
  lifecycle/replay work, still no reboot survival).
