---
feature: 2026-10-07-grove-cli
phase: questions
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 00-ticket.md
forced: []
---

# Grove CLI

## Goal

Give grove a CLI, like Xirp's and herdr's, so that agents running in grove
sessions can open other sessions in grove (and list and message them),
talking to the running app.

## Out of scope

- Packaging and code signing (epic child 8); this feature only has to make
  the command reachable from grove sessions.
- Worktrees per session (ADR 0020 consequence, planned later).
- Workflow features: next actions, stages or the features board (on hold per
  ADR 0020).
- A remote or network API: the CLI talks to the app on the same machine.

## Research questions

1. What operations does core expose for sessions and projects today (the
   `Core` interface's methods, their arguments, results and error shape), and
   how does the renderer invoke them through IPC and preload?
2. How is a session created end to end: how its project, working directory,
   kind, label and link are set, how the agent or shell command line is built
   per kind, and what state is persisted and pushed when it starts?
3. What launch options do the installed `opencode` and `claude` CLIs offer
   for starting a session with an initial message, a working directory or a
   title, and which of them does the app use today?
4. What environment does a session process receive (ADR 0010's login-shell
   env, per-kind additions such as hook settings), and where is it assembled?
5. What does Electron main start and own besides the window and renderer IPC
   (custom protocols, sockets, child processes, servers), what lives under
   `userData`, how does the app behave if a second instance starts, and what
   is torn down on quit?
6. What mechanisms exist today for getting text into a running session from
   outside its TUI (tmux commands, OpenCode server API, Claude Code channels),
   and what has the `2026-10-07-review-comments` feature decided or built so
   far?
7. How are session status changes (`working`, `waiting`, `idle`, `gone`)
   produced and observed inside core, and what events or listeners can code in
   main subscribe to?
8. How is focus changed (focusing a session, a project page), and does main
   do anything to raise or reveal the window or notify the human?
9. What is the shape of the persisted session record (fields, ids, label,
   link, pinned flag, timestamps), how is it versioned and migrated, and is
   there any relationship between sessions recorded today?
10. How is the app built and run in dev and in a build (electron-vite config,
    entry points, output folders, `package.json` scripts and `bin`), and does
    the repo ship any executable scripts besides the app?
11. What command surface, transport, discovery of the running app, and output
    formats do the installed `xirp` and `herdr` CLIs use, and how do they learn
    which session the caller runs in?
12. How do agent sessions started by grove receive instructions or skills
    today (repo `AGENTS.md`, per-launch flags or settings, skill folders), for
    both OpenCode and Claude Code?

## Product questions for the human

1. **Who uses the CLI.** Only agents inside grove sessions, or also you from
   any terminal (and scripts)? — **Both**: agents in grove sessions and the human
   from any terminal or script on this machine.
2. **Where new sessions may start.** May a session start sessions only in its
   own project, in any registered project, or in any folder (registering it as
   needed)? — **Any folder**, registering it as a project if needed.
3. **App not running.** When the app isn't running: fail with a clear error,
   or launch the app? — **Fail clearly**: an error saying the app isn't running,
   nonzero exit.
4. **Focus on spawn.** When an agent starts a session, should the app switch
   to it, or start it in the background (it shows up in the sidebar and
   sessions board)? — **Background**: it appears in the sidebar and sessions
   board; focus changes only on an explicit request.

## Size verdict

**M.** One clear result and mostly familiar modules (core session methods,
session env, main), plus one new piece: a CLI and its transport. It carries
several one-way decisions (command surface and output, protocol and
versioning, destructive commands, parent tracking, how the command is
installed), likely within `limits.maxOneWayDecisions` (8), and about 4–6
slices.

**Proposed flow: standard** — size M; design and slices fit one review, as
with `2026-10-07-session-diff`.

## Open questions
