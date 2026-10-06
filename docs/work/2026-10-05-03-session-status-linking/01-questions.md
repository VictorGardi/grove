---
feature: 2026-10-05-03-session-status-linking
phase: questions
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@5
  - parent:04-structure.md@5
forced: []
---

# Questions: session status, linking and resume

Child 3 of epic `2026-10-05-opencode-feature-workspace`. The epic's research
(v5) and design (v5) are inherited, plus child 1's Phase 0 findings (its
`02-research.md` v2: `-s <id>` creation, SSE sequences for write/edit, path
fields on tool events). Settled and not re-asked: E-D3 (tmux on `-L grove`),
E-D5 (one SSE client on the shared OpenCode service, HTTP re-sync, tmux for
`gone`), E-D6 (link to the folder of the latest edit/write, manual link pins,
startup catch-up from messages, terminals manual), E-D7 (`opencodeSessionId`,
`feature`, `lastStatus`, `endedAt`). Children 1, 9 and 2 have been built since
the epic's research, so the questions cover the code as it is now and the
OpenCode behaviour the earlier research left open.

## Goal

Live session status, sessions link to features without manual work, and dead
OpenCode sessions can be resumed.

## Out of scope

- Next-action buttons, prompt injection into running sessions, idle-session
  paste targets (child 5)
- Artifact viewing and comments (children 4, 6)
- Command palette and grid view (child 7), packaging (child 8)
- Status for agents other than OpenCode; status beyond running/gone for plain
  terminals
- Re-deciding any `E-D` id

## Research questions

1. How does core track a session's lifecycle today: where `lastStatus` and
   `endedAt` are set, when and how tmux liveness is checked (start-up,
   timers, attach/exit events), how the `sessions` slice is persisted and
   pushed to the renderer, and which IPC channels touch sessions?
2. How does the app create a tmux session today — name, cwd, env (ADR 0010),
   command line for each kind, and how `opencodeSessionId` is generated —
   and which fields of a stored session record are written only at creation?
3. Where does the OpenCode 2.0.20 shared service record how to reach it
   (`service.json` or otherwise): file location, fields, permissions, and how
   the CLI uses them to authenticate? What happens to that file and to open
   connections when the service stops, restarts or is replaced on a version
   change?
4. How does `GET /api/event` behave across disconnects: event ids, any
   `Last-Event-ID` or replay support, heartbeat, and what a client sees when
   the service goes away and comes back?
5. Which HTTP operations report the current state of one or many sessions —
   whether an execution is running, pending permission requests, pending
   forms/questions — and what do they return for a session that exists, one
   that does not exist yet, and one whose TUI has exited?
6. How can a session's past tool calls be read after the fact (HTTP and/or
   the SQLite store, v1 and v2 schemas): which operation or table, the shape
   of write/edit/patch tool parts, where file paths appear, and how results
   are ordered and paginated?
7. Which OpenCode 2.0.20 tools modify files (write, edit, patch/apply-patch,
   multi-edit, others), and which event and message fields carry the target
   path for each, including writes outside the session's Location
   directory?
8. How do sub-sessions (task/subagent runs) appear in events and the API:
   their ids, parent reference, `location`, and whether their tool and
   execution events are distinguishable from the parent session's?
9. What does `opencode -s <id>` do when the id names an existing session that
   has history, including one created in a different directory and one whose
   last execution was interrupted? What does the TUI show on open?
10. How do the discovery code and the `features` slice represent feature
    folder locations (absolute path, project root, slug), and how are paths
    normalised (symlinks such as `/tmp` → `/private/tmp`, trailing slashes,
    case)?
11. How does current code compute card state and stage for features, which
    session fields it reads, and where the renderer shows session status,
    counts and banners today (header, session card, feature page)?
12. How do Electron 44 `Notification`s behave on macOS for this app when run
    from `npm run dev` and from an unsigned or ad-hoc-signed build: whether
    they appear, what permission prompt or app identity is used, and whether
    `click` fires and can bring the window forward?
13. What does main and the renderer know today about which session is on
    screen (attached, selected in the sidebar) and whether the window is
    focused, and which events or IPC calls carry that?

## Product questions for the human

1. **What counts as "waiting"?**
   _Answer:_ Waiting means it's my move: OpenCode is blocked on a permission
   request or a question, **or** the agent has finished its turn. A finished
   session becomes idle once I've seen or acknowledged it (for example by
   focusing it).
2. **When should a notification not fire?**
   _Answer:_ Suppress it only when the grove window is focused **and** that
   session is the one on screen. In every other case, notify.

## Size verdict

Not applicable: child of an epic, sized by the epic's structure (4 days,
about 6 slices; resume is the last slice, appetite cut 3).

## Open questions
