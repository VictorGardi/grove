# 0027. The Grove CLI talks to the running app over a Unix socket in userData

Date: 2026-10-07

## Status

Accepted

## Context

ADR 0020 adds a `grove` CLI so agents in grove sessions, and the human, can
list, start, message, wait on, focus and kill sessions in the running app.
Electron main opens no socket or server today, and has no single-instance
lock. xirp uses a WebSocket daemon reached through a Unix socket. herdr uses
a JSON request/response protocol on a Unix socket, and injects pane identity
into the environment.

## Decision

- **Socket and lock:** main listens on `<userData>/grove.sock` (mode 0600)
  while the app runs, behind a single-instance lock.
- **Protocol:** one request per connection, as a JSON line
  `{v:1, id, method, params}`. The reply is `Result`-shaped:
  `{id, ok, data}` or `{id, ok:false, error:{code, message}}`.
- **Commands:** the surface is `ls`, `new`, `send`, `wait`, `read`, `focus`,
  `kill` and `skill`. It has human output, `--json`, and fixed exit codes:
  0 ok, 1 app error, 2 usage, 3 app not running, 4 waiting for the human,
  5 gone, 124 timeout.
- **Identity:** sessions get `GROVE_SESSION_ID` and `GROVE_SOCKET` through
  tmux `new-session -e`.
- **Access:** any caller may kill any session (the human's choice). No
  parent relationship is recorded.

## Consequences

- No port, token or extra dependency. Only processes of the same user reach
  the socket, the same trust as `tmux -L grove`.
- The command surface and exit codes are a contract for agent skills and
  scripts: changing them needs a protocol `v` bump or a compatible addition.
- A second app instance now focuses the first and exits.
- Rejected: HTTP on localhost (a port file, a token, and other local apps can
  reach it); WebSocket framing (a dependency, for one-shot requests).
