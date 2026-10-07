---
feature: 2026-10-05-10-claude-code-sessions
phase: questions
status: approved
version: 1
created: 2026-10-06
updated: 2026-10-06
approved_at: 2026-10-06
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@5
  - parent:04-structure.md@5
forced: []
---

# Questions: Claude Code sessions

Child 10 of epic `2026-10-05-opencode-feature-workspace`, not in the epic's
approved structure (v5). The epic's research (v5) and design (v5) are
inherited. The epic's Non-goals exclude "running agents other than OpenCode
(the adapter should allow it later)", and E-D3 (resume argv), E-D5 / ADR 0005
(status from the OpenCode service) and E-D7 (`opencodeSessionId`) are written
for OpenCode only. This child never overrides an `E-D` id; where it needs one
changed, that goes to the epic's design. Children 1, 9, 2 and 4 are built and
child 3 is mid-implementation (slice 1 of status and linking committed; its
design and structure are currently `stale`), so the questions cover the code
as it is now plus the Claude Code CLI as installed (2.1.285).

## Goal

Add Claude Code as a second session kind alongside OpenCode, started, resumed
and shown in the app like an OpenCode session.

## Out of scope

- Agents other than OpenCode and Claude Code
- Next-action buttons and prompt injection (child 5), though child 5 may plan
  for both agents
- Artifact viewing and comments (children 4, 6), palette and grid (child 7),
  packaging (child 8)
- Changing OpenCode session behaviour, beyond what sharing code with a second
  kind requires

## Research questions

1. Where does the code today name or branch on a session's kind (types, core,
   IPC, renderer: the ＋ modal, icons, labels, status display, resume)? List
   every OpenCode-specific place and what it does.
2. How are an OpenCode session's id, launch command line and resume command
   line produced today, including id generation, the login-shell env wrapping
   (ADR 0010), the cwd, and the tmux session naming?
3. What is persisted per session in `state.json` today, which fields are
   OpenCode-specific, and how are schema versions and migrations of app state
   handled?
4. How does the session status pipeline work in the code today: the source of
   events, its interface or seam toward core, the mapping to working / waiting
   / idle / gone, the seen mark (ADR 0015), re-sync on (re)connect, and the
   fallback when the source is unreachable? Which parts are OpenCode-specific
   and which are agent-neutral? Where child 3's design describes parts not yet
   built, report them separately from built code.
5. How is a session linked to a feature today: manual linking and pinning in
   code, and auto-linking and startup catch-up as built or as child 3's design
   describes them?
6. By what channels does Electron main receive information from outside its
   own process today (sockets, local ports, HTTP clients or servers, file
   watchers, polling), and what local listeners does the app open?
7. For the installed `claude` CLI (2.1.285): which command-line flags and
   settings does it accept for starting an interactive session with a
   caller-chosen id, resuming one by id, starting with an initial prompt or
   slash command, and supplying settings per invocation? Cite `claude --help`
   and official docs.
8. What mechanisms does the Claude Code CLI provide for another local process
   to observe a running interactive session: turn start and end, a pending
   permission prompt or question to the user, tool calls and their file
   paths? For each, what is documented about its events, payload fields and
   delivery (and what is not documented)?
9. What does Claude Code write to disk per session (location, how the
   directory name derives from the cwd, file format, record types relevant to
   turns, tool calls and file paths), and what is documented about its
   stability?
10. How are the session sources, tmux backend and status logic tested today
    (fakes in `src/core/testing`, unit tests, manual checks), and what would a
    test of a session source need to provide?

## Product questions for the human

1. **Epic widening, process.** Research this child first. Then revise the
   epic's design and structure: lift the Non-goal, generalise E-D3, E-D5 and
   E-D7 (appending new `E-D` ids as needed) and add child 10. Do this before
   this child's design runs. (Human, 2026-10-06.)
2. **Scope.** Full parity with OpenCode sessions: start and resume, plus live
   working / waiting / idle / gone status, notifications, the waiting count
   and auto-linking. Live status is not deferred. (Human, 2026-10-06; the
   ticket estimates ~4–5 days.)
3. **Build order.** Right after child 3 finishes and before child 5, so
   child 5's next actions are designed for both agents. The epic revision
   puts it in `children:` after child 4 and sets the `order` fields (this
   child's `order: 10` in `feature.md` is provisional). (Human, 2026-10-06.)
4. **Appetite.** Raise the epic's appetite from ~5–6 weeks to ~6–7 weeks to
   cover this child. The existing cuts stay as they are. The epic revision
   records the change. (Human, 2026-10-06.)

## Size verdict

Not applicable: a child's size is bounded by the epic's structure. This child
is not yet in that structure; its size goes there when the epic is revised.

## Open questions
