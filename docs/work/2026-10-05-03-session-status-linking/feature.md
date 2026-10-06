---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 4
flow: standard
created: 2026-10-05
---

# Session status, linking and resume

Child 3 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Live session status, sessions link to features without manual work, and dead OpenCode sessions can be resumed.

## Outcome

Every OpenCode session shows working / waiting / idle / gone in the sidebar, and statuses roll up to features. The header shows a waiting count. A native notification fires when a session starts waiting, and clicking it focuses the session. A session that writes into a feature folder becomes linked to that feature unless the link is pinned. After a restart, status and links catch up. If the OpenCode service is unreachable, the app falls back to tmux liveness and shows a banner. A `gone` OpenCode session (after a reboot or a tmux server kill) offers Resume, which starts a new tmux session running `opencode -s <opencodeSessionId>` in the same project. It keeps the session's id, label and feature link.

## Scope

E-D3 (new tmux session for resume), E-D5, E-D6, E-D7 (`opencodeSessionId`, `feature`, `lastStatus`, `endedAt`). Design: Desired state 3 (status, waiting count, notifications), 4 (auto-link); "Sessions, backend and status" flows *Auto-link* and *App start* (re-sync and catch-up); card states `running` and `waiting`; two-way row Notifications; Risks covering the Experimental API, `service.json`, and reboot or tmux server kill (resume).

## Dependencies

1 (sessions), 2 (feature folders to link to).

## Size estimate

4 days, about 6 slices. Resume is the last slice (appetite cut 3).

## Flow log

- 2026-10-05: standard (default for an epic child; confirmed by the human in questions)
