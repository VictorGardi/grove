Source: the epic's 04-structure.md (v5), child entry 3, verbatim. No separate ticket: the human started this child with `grove-start 2026-10-05-03-session-status-linking` on 2026-10-05.

### 3. `2026-10-05-03-session-status-linking`

- **Goal:** live session status, sessions link to features without manual
  work, and dead OpenCode sessions can be resumed.
- **Outcome:** every OpenCode session shows working / waiting / idle / gone in
  the sidebar, and statuses roll up to features. The header shows a waiting
  count. A native notification fires when a session starts waiting, and
  clicking it focuses the session. A session that writes into a feature folder
  becomes linked to that feature unless the link is pinned. After a restart,
  status and links catch up. If the OpenCode service is unreachable, the app
  falls back to tmux liveness and shows a banner. A `gone` OpenCode session
  (after a reboot or a tmux server kill) offers Resume, which starts a new tmux
  session running `opencode -s <opencodeSessionId>` in the same project. It
  keeps the session's id, label and feature link.
- **Scope:** E-D3 (new tmux session for resume), E-D5, E-D6, E-D7
  (`opencodeSessionId`, `feature`, `lastStatus`, `endedAt`).
  Design: Desired state 3 (status, waiting count, notifications), 4
  (auto-link); "Sessions, backend and status" flows *Auto-link* and *App start*
  (re-sync and catch-up); card states `running` and `waiting`; two-way row
  Notifications; Risks covering the Experimental API, `service.json`, and
  reboot or tmux server kill (resume).
- **Depends on:** 1 (sessions), 2 (feature folders to link to).
- **Size:** 4 days, about 6 slices. Resume is the last slice (appetite cut 3).
