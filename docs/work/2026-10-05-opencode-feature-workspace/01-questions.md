---
feature: 2026-10-05-opencode-feature-workspace
phase: questions
status: draft
version: 3
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 00-ticket.md
forced: []
---

# Questions: feature-focused desktop workspace for OpenCode

## Goal

A macOS desktop app that combines Xirp's model (real coding-agent TUIs in
persistent terminals with live status) and HumanLayer's model (work organized
around features with stages, artifacts, sessions and a clear next action). All
workflow knowledge lives in one `workflow.yaml`. The app embeds OpenCode's own
TUI and does not build a chat UI.

## Out of scope

- A custom chat UI or custom message rendering
- Cloud sync, accounts, telemetry, multi-user features
- Linux and Windows support
- Editing artifacts inside the app
- Running agents other than OpenCode (the adapter should allow it later)
- Changes to the grove-skills repo. These are only noted in
  `docs/skills-changes.md`.

## Research questions

1. **herdr.** What interface does herdr expose (CLI, socket, HTTP)? What does
   it return when it creates a workspace or pane, and are those ids stable
   across restarts? How does it detect and report agent state, in what format,
   and through polling or events? How are its panes rendered? Can one pane's
   byte stream be reached by a process other than herdr's own UI? Does it record
   any identifier from the program running in a pane? (herdr isn't installed on
   this machine yet.)
2. **tmux.** How do detached sessions behave when no client is attached? What
   ways exist for an outside process to read a pane's output and send it input
   (attach through a PTY, control mode `-CC`, `pipe-pane`, `capture-pane`,
   `send-keys`)? What does each of them do to terminal sizing, colors and mouse?
   What pane metadata and activity signals (hooks, `#{pane_*}` formats,
   `monitor-activity`/`monitor-silence`) can be queried?
3. **OpenCode CLI surface** (installed at `/opt/homebrew/bin/opencode`). What
   subcommands and flags does the installed version have for starting the TUI
   (initial prompt or command, model, agent), continuing or resuming a session,
   and running a server? How do the TUI process and its local server relate,
   and how is the port chosen?
4. **OpenCode state.** What does the OpenCode server expose (HTTP routes, SSE
   event stream)? What event types and fields does it emit while a session is
   busy, idle, asking for a permission, or asking the user a question? Where
   does OpenCode store sessions on disk, and how are session ids formed?
5. **The previous grove app** (commit `f5a1c17`, before
   `15ec3b4 clean up and start over`). How did it structure Electron main,
   preload and renderer IPC, PTY handling (`src/main/pty.ts`,
   `src/main/ipc/taskTerminal.ts`), file watching (`watchers.ts`) and
   frontmatter parsing? What did its plan for "streaming of opencode" contain,
   and which of its recorded tasks in `.grove/tasks/` describe problems hit with
   xterm.js, node-pty or OpenCode?
6. **xterm.js + node-pty inside Electron.** How do current versions behave with
   a full-screen TUI like OpenCode: truecolor, mouse reporting, alternate
   screen, resize propagation, WebGL renderer? Which key combinations are
   captured by Electron menus, macOS or xterm.js before reaching the PTY? What
   is involved in building node-pty against Electron's ABI?
7. **Grove artifact formats today** (`~/git/grove-skills`, `shared/contract.md`).
   Which `feature.md` and artifact frontmatter fields exist, which file names
   are fixed, and how do approval, `stale` status and epics (`kind`, `parent`,
   `children`) appear on disk? Do the skills support multiple repos per feature,
   per-repo artifact names, a hub repo, or a `grove.hub.json`/`featuresDir`
   config? An initial search found no `grove.hub.json` or `featuresDir` in
   grove-skills.
8. **Xirp** (installed CLI at `~/.local/share/chirp/cli/external/xirp`). What
   commands does it expose for sessions, projects and status? How does it
   detect agent status, and how does it keep sessions alive when its window is
   closed?
9. **Sandboxed HTML in Electron.** How can local artifact HTML (from
   `grove-render`, which loads Mermaid and other scripts) be shown in an iframe
   without same-origin access: `file://`, a custom protocol, `srcdoc`, or a
   `<webview>`? Which CSP and sandbox flags does each need?
10. **Plannotator.** What is it, how is it installed and invoked, and what
    arguments does it take to open a markdown file? (It isn't installed on this
    machine.)

## Product questions for the human

1. **App name.** "grove". Config lives at `~/.config/grove/config.json`, and
   the bundle id and window title use "grove".
2. **Multi-repo scope.** v1 is single-repo. Features are discovered from each
   registered repo's `grove.config.json` `artifactRoot`. The discovery and
   `workflow.yaml` designs must leave room to add a hub (`grove.hub.json`,
   `featuresDir`), `feature.repos` and `per_repo` stages later without a
   rewrite. Hub and per-repo support go into `docs/skills-changes.md` as a
   prerequisite for the skills repo.
3. **Epics on the board.** Group header: the epic is a collapsible row with its
   own stage and actions, and its children are indented under it. This means
   `workflow.yaml` has to describe feature kinds and the parent/child link
   generically, without naming grove's `kind: epic`.
4. **Stack.** Electron as specified: electron-vite, TypeScript, React,
   xterm.js (WebGL + fit), node-pty, chokidar, gray-matter, yaml, markdown-it
   + Mermaid, vitest.
5. **herdr.** Research may install herdr and run real spikes against it.
6. **`.grove/`.** Delete it as part of this epic, including its `.gitignore`
   line. The new app never reads it.
7. **"Waiting" status.** If research shows OpenCode's server status can be
   reached for each TUI instance, the terminals child uses it from the start
   (pulled forward from polish). If not, it falls back to the backend's status.

## Open questions
