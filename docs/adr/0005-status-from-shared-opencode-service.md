# 0005. Session status from the shared OpenCode service's event stream

Date: 2026-10-05

## Status

Accepted

## Context

Status dots, the waiting count, notifications and session-to-feature linking
all need to know what each OpenCode session is doing. Screen parsing (the
previous app, Xirp) produced a long tail of false states. OpenCode 2.0.20's TUI
always talks to a server, by default a shared service on `:49374` whose url and
password are in `~/.local/state/opencode/service.json`. Its SSE stream emits
typed execution, permission, form and tool events per `sessionID`.
`opencode -s <id>` uses a given id for the first new session.

## Decision

OpenCode TUIs start in default mode as `opencode -s <app-generated ses_ id>`,
joining the shared service. The app reads `service.json`, holds one SSE
connection to `/api/event`, and keeps events for known session ids. `working`
follows `session.execution.started`; `waiting` while a `permission.asked` or
`form.created` is unresolved; `idle` after the execution ends with nothing
pending; `gone` comes from tmux. On every (re)connect and on app start the app
re-syncs from `GET /api/session/active`, `/api/permission/request` and
`/api/form`. It watches `service.json` to follow service restarts.

## Consequences

- Status, waiting and session ids are signals, not guesses; the id enables
  resume after a reboot and feeds linking.
- Depends on an API OpenCode labels "Experimental" and on reading a secret
  file; an OpenCode upgrade can break it, so the client is isolated in one
  module.
- Sessions run outside the app share the service and are ignored.
- Phase 0 verifies `-s <generated id>`, live event sequences and the
  service-restart path; a failure reopens this decision.
- Rejected: tmux screen parsing (heuristic, no ids or file events); an
  app-owned `opencode serve` with `--server` (extra supervised process, version
  drift, same API risk).
