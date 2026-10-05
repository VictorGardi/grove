### 1. `2026-10-05-01-workspace-walking-skeleton`

- **Goal:** the thinnest end-to-end app. Add a project, start a session,
  work in it, quit, reopen, and find it still there.
- **Outcome:** in the running Electron app I add a repo folder as a project.
  Cmd+T opens the ＋ modal, where I pick the project and OpenCode or Terminal.
  The session runs in tmux (`-L grove`) and appears under its project in the
  sidebar, attached in xterm.js. After I quit and relaunch, it is listed and
  re-attaches. A session killed outside the app shows `gone`.
- **Scope:** E-D1 (projects only, not discovery), E-D3, E-D4, E-D7 (config
  `projects`, `state.json` sessions, atomic writes). Design: Desired state 1, 2,
  8, 9; "Sessions, backend and status" flows *New session* and *App start*
  (tmux part only); "App state"; two-way rows IPC, Terminal, node-pty, Keys,
  Window close, Plain terminals, Phase 0.
- **Phase 0:** this child's research runs the spikes in `spikes/` and records
  the findings: tmux attach and replay, `opencode -s <generated id>`,
  `--prompt "/cmd"`, SSE tool events carrying file paths, bracketed paste,
  xterm.js keys and colours. Any failure reopens the matching epic decision
  (via the epic's Open questions) before app code depends on it.
- **Depends on:** none.
- **Size:** 6–7 days, about 6 slices, at most 2 own one-way decisions.

