---
feature: 2026-10-05-05-next-actions
phase: questions
status: draft
version: 1
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@5
  - parent:04-structure.md@5
forced: []
---

# Questions: next actions

Child 5 of epic `2026-10-05-opencode-feature-workspace`. The epic's research
(v5, Q2 tmux, Q3 OpenCode CLI surface) and design (v5) are inherited. E-D2
(the `actions` / `stage_actions` contract and template variables), E-D3 (tmux
backend) and E-D5 (status from the OpenCode service) are settled and not
re-asked here. The two-way row "Prompt injection" (`--prompt` at start,
bracketed paste + Enter for follow-ups) is also inherited. Children 1, 9, 2
and 4 have been built since the epic's research. Child 3 (status, linking) is
part-built: slices 1–2 of 6 are done. So the questions below cover the code
as it is now.

## Goal

Move a feature forward from its page.

## Out of scope

- Comments, the review tray, and sending comments as `{feedback}` (child 6).
  This child provides the send path that child 6 uses.
- Session status, waiting detection, auto-link and resume themselves (child 3)
- Command palette and grid view (child 7)
- Creating features from the app (an epic non-goal)
- Changes to the grove-skills repo (noted in `docs/skills-changes.md` only)

## Research questions

1. **Feature page today.** What does the renderer's feature page show, and
   where does that data come from? Cover the derived stage, card state, flags
   and linked sessions, and the data shapes crossing IPC. Which interactive
   controls, dialogs and text-input patterns exist in the renderer today
   (modals, pickers, confirm dialogs)?
2. **Workflow actions in core.** How does `src/core/workflow/parse.ts`
   validate `actions`, `stage_actions` and template strings? What happens to
   the parsed `actions` / `stage_actions` after parsing: are they used by
   derivation, sent to the renderer, or unused? Which template variables are
   accepted or rejected, and how is a template string checked?
3. **Starting a session.** Trace the path from the new-session modal to a
   running session: IPC, core, the backend call, the exact command line built
   for an OpenCode session and for a terminal, how cwd and environment are
   set, and which `Session` fields are written (including `feature`,
   `linkPinned`, `action`). After start, how does the renderer select and
   attach the new session?
4. **Sending input to an existing session.** Which operations does the tmux
   backend (and the `Backend` type, and the herdr stub) expose today besides
   create/attach/list/kill? How does text typed in xterm.js reach a tmux
   session? Did the Phase 0 spikes (`spikes/`, child 1's research) test
   `opencode --prompt` with a slash command, or pasting text into a running
   OpenCode TUI via tmux? What did they find?
5. **Session status as built.** Which per-session statuses does core compute
   today (`src/core/status.ts`, `src/core/opencode/`)? How are they derived
   from OpenCode service events, how do they reach the renderer, and how do
   a feature's linked sessions feed its card state (`running` / `waiting`)?
   Which of child 3's remaining slices (re-sync, seen mark, auto-link,
   resume) touch these same modules, per its `04-structure.md`?
6. **OpenCode TUI input behaviour.** For OpenCode 2.0.x: how does the TUI
   handle `--prompt` text that starts with `/`? Does it run it as a command
   or submit it as a message? What happens when text is pasted or submitted
   while a turn is already running (queued, rejected, interrupting)? How does
   it detect bracketed paste? Cite the source or observed behaviour.
7. **Grove's command surface.** Which slash commands do the installed grove
   skills expose, and with what arguments? Cover `grove-start`,
   `grove-questions`, `grove-research`, `grove-design`, `grove-structure`,
   `grove-implement` and `grove-approve`, including approval unit names. For
   each flow (`full`, `standard`, `small`), which command does a human run to
   start or revise each stage? How do they compare with the `actions` in
   `resources/workflow.yaml`? How does OpenCode discover these skills or
   commands in a project?
8. **Tests.** How are core sessions, the backend and the workflow parser
   tested today (vitest setup, `src/core/testing/` fakes)? What would the
   fake backend need in order to record input sent to a session?

## Product questions for the human

1. **Which actions reuse an idle linked session.** *Answer:* Start always
   opens a new session, so each phase gets a fresh context. Approve and Revise
   are pasted into an idle linked session if one exists, and otherwise start a
   new linked session.
2. **Several idle linked sessions.** *Answer:* paste into the one with the
   most recent activity, picked automatically.
3. **Finished but unseen sessions.** *Answer:* a session that is `waiting`
   only because its turn finished and hasn't been seen is a valid paste
   target. Clicking the action implies the output was reviewed. A session
   waiting on a permission or a question is never a target.
4. **Where the human lands after clicking.** *Answer:* stay on the feature
   page. The session appears in the sidebar and among the feature's linked
   sessions, whether it was started new or pasted into.

## Size verdict

Not applicable: an epic child, bounded by the epic's structure (2 days,
about 4 slices).

## Open questions
