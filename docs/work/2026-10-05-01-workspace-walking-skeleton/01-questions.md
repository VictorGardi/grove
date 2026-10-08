---
feature: 2026-10-05-01-workspace-walking-skeleton
phase: questions
status: draft
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@1
  - parent:04-structure.md@2
forced: []
---

# Questions: workspace walking skeleton

Child 1 of epic `2026-10-05-opencode-feature-workspace`. The epic's research
(v5) and design (v1) are inherited. E-D1 (projects only), E-D3, E-D4 and E-D7
are settled and are not re-asked here. The questions below cover only what the
epic research left open or did not reach, in this child's area.

## Goal

The thinnest end-to-end app. Add a project, start a session, work in it, quit,
reopen, and find it still there.

## Out of scope

- Feature discovery, `workflow.yaml`, the feature tree and feature page (child 2)
- OpenCode session status beyond tmux liveness, auto-linking, notifications,
  resume of `gone` sessions (child 3). Phase 0 still *runs* the SSE spike;
  child 3 consumes the finding.
- Artifact viewing and comments (children 4, 6)
- Next-action buttons and prompt injection into sessions (child 5). Phase 0
  still runs the `--prompt` and bracketed-paste spikes.
- Command palette and grid view (child 7)
- Packaging a `.app` (child 8)

## Research questions

Phase 0 (spikes in `spikes/`; each answer is an observed result on this machine):

1. On a tmux server started with `-L <name>` and an explicit `-f <config>`,
   what happens to an OpenCode 2.0.20 TUI's screen, mouse mode and colours
   when a node-pty client attaches, detaches and re-attaches? Which of the
   behaviours Xirp works around (OSC 10/11 colour queries, mouse-mode replay)
   reproduce, and what does the TUI draw at the session's initial size before
   any client attaches?
2. What does `opencode -s <id>` do when `<id>` is a client-generated value in
   the `ses_` format that does not exist yet: is the session created with that
   exact id, and is it visible through `GET /api/session/{id}` on the shared
   service? What happens with an id in the wrong format?
3. What does `opencode --prompt "/<command> <args>"` do end to end for a
   command that exists, for one that does not, and for plain text?
4. What sequence of `/api/event` SSE events does the shared service emit for
   one OpenCode turn that edits or writes a file, and which fields carry the
   file path (absolute or relative, and relative to what)?
5. What reaches the OpenCode TUI when text is sent into its tmux pane as a
   bracketed paste followed by Enter, by each available tmux route
   (`send-keys -l`, `send-keys -H`, `paste-buffer -p`)?
6. In xterm.js 6.0.0 inside Electron 44, attached to that tmux session: which
   keys OpenCode needs (Shift+Enter, Option/Alt combinations, Ctrl keys, Esc)
   arrive as expected, and does truecolor render with the env the PTY is given?

Delta questions about the current environment:

7. When an Electron app is launched from Finder or the Dock rather than a
   shell, what environment (`PATH`, `SHELL`, locale, `HOME`) does its main
   process have, and what environment does a tmux server it starts pass on to
   new sessions? Is `/opt/homebrew/bin` (tmux, opencode) reachable from it?
8. How does tmux 3.6b report each of these on a `-L` socket, by exit code and
   output: no server running, server running with zero sessions, a named
   session that exists, and one that was killed? What do `exit-empty` and
   `destroy-unattached` do to the server and sessions when the last client
   detaches or the last session ends?
9. Does node-pty 1.1.0's darwin-arm64 prebuild load in Electron 44's main
   process without a rebuild, under the dev runner and under a production
   build, and what is the current state of the `spawn-helper` permission issue
   in 1.1.0 vs 1.2.0-beta?
10. Which current electron-vite (or equivalent) release supports Electron 44
    with Node 26, and which parts of the previous app's build setup at
    `f5a1c17` (`electron.vite.config`, tsconfigs, `package.json` scripts,
    `electron-builder.yml`, vitest config) still work against current
    versions? Did `f5a1c17` typecheck and pass its tests?
11. In Electron 44 on macOS, with a custom application menu installed: does a
    renderer `keydown` `preventDefault()` or `before-input-event` stop a menu
    accelerator, and which of the reserved keys (Cmd+T, Cmd+W, Cmd+Q, Cmd+1..9)
    reach the page versus the menu?
12. What do `app.getPath('userData')` and `~/.config` resolve to for an
    Electron app named `grove` in dev and in a built app, and do
    `~/.config/grove/` or `~/Library/Application Support/grove/` already exist
    on this machine with content from the previous app?
13. Does OpenCode 2.0.20 give a session a title of its own: when is it set or
    changed, what produces it, and where is it exposed (session HTTP routes,
    SSE events, the SQLite store)? Can a title be set from outside the TUI?

## Product questions for the human

1. **Renderer stack.** The previous app used React. Should this one keep React
   (and the same electron-vite / electron-builder toolchain), or do you want
   something else?
   - *Answer:* Keep React with the same toolchain: electron-vite,
     electron-builder, vitest. Reuse the old build config where it still works.
2. **Adding a project.** Is a native folder picker enough? Should the app
   refuse folders that aren't git repos or lack `grove.config.json`, or accept
   any folder? Is removing or renaming a project in this child?
   - *Answer:* Native folder picker, any folder, no validation. Removing a
     project is in this child; renaming is not. Removal is refused while the
     project has live sessions; its `gone` sessions are dropped with it.
3. **Ending a session.** What should Cmd+W do on a focused session: close the
   view only (session keeps running in tmux), or kill the session? Is there a
   kill action in this child at all, and can `gone` sessions be removed from
   the sidebar?
   - *Answer:* Cmd+W on a focused session asks for confirmation, then kills
     its tmux session. A killed session shows as `gone` like any other. `gone`
     sessions have a manual Remove action that drops them from state.
4. **Session labels.** Does the ＋ modal ask for a label, or is one generated
   (for example kind + time), with renaming later?
   - *Answer:* The modal has no label field. The label is generated: from
     OpenCode's own session title if it provides one (see research question
     13), otherwise by the app (terminal sessions always get an app label).
     Renaming a session in the sidebar is in this child.
5. **Spike scripts.** Should `spikes/` be committed to the repo as a record, or
   kept out of git with only the findings written into research?
   - *Answer:* Gitignore `spikes/`. Only the findings in `02-research.md` are
     kept, so they must say enough to reproduce each result.

## Open questions
