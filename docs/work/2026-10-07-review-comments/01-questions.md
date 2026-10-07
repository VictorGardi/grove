---
feature: 2026-10-07-review-comments
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

# Review comments

## Goal

Add several comments to a session's diff lines and to text in markdown
artifacts, collect them, and pass them back to that session together, so the
human can review what an OpenCode or Claude Code session produced without
leaving the app.

## Out of scope

- Editing files or artifacts in the app.
- Per-session diffs (worktrees per session), per ADR 0020.
- Next actions (epic child 5) and the workflow `{feedback}` variable: this
  feature builds its own send path.
- Comments on project files opened through the `~file` route (ADR 0022).
- Comments on HTML artifacts (sandboxed iframe, ADR 0007): a follow-up.
- Threaded discussion or replies from the agent shown in the app.

## Research questions

1. What does the tmux backend expose today for interacting with a running
   session (commands it issues, how input or keys reach a pane, buffers,
   error handling when the tmux session no longer exists)?
2. Which parts of OpenCode's server API does the app use today, and what
   does that API offer for acting on an existing session from outside its
   TUI?
3. How is a Claude Code session launched (command, flags, hooks, env), and
   what channels exist for a process outside the TUI to act on a running
   Claude Code session?
4. How is session status (`working`, `waiting`, `idle`, `gone`) derived per
   agent kind, how fast does it change, and where is it available in core and
   in the renderer?
5. How is the session diff computed, parsed and represented (data model, diff
   line identity), how does `DiffViewer` render it, and when does it refresh?
6. How are markdown artifacts rendered (pipeline in main, the HTML produced,
   how the renderer displays it), and how are HTML artifacts served and
   isolated — including any injected script or `postMessage` channel?
7. How is a viewer target (artifact, project file, diff) chosen, held and
   switched, and what does the viewer know about the file's version or
   frontmatter and about changes to it on disk?
8. How is app state stored and pushed to the renderer: the existing slices,
   their JSON files, schema versioning and migrations, and the IPC/preload
   surface for renderer → core actions?
9. What code, types or glossary entries exist today for comments, comment
   drafts or a review tray, and what did the superseded epic child
   `2026-10-05-06-artifact-comments` and the epic design record about them?
10. How does a session relate to a project, a working directory and a linked
    feature, and can a given diff or artifact be traced to one session or to
    several?

## Product questions for the human

1. **Tray scope.** Is the tray (the collected drafts) per session, per
   feature, or one global tray where you pick the target session on send?
   — **Per session.** Each session has its own tray; sending goes to that
   session. Diff and artifact comments are added in that session's context.
2. **Sending to a busy or gone session.** When the target session is
   `working`, or `gone`: send anyway, hold until it's idle, refuse, or (gone)
   resume it first? — **Send anyway; resume if gone.** Working: send
   immediately (the agent queues or interrupts as it normally does). Gone:
   resume the session, then send.
3. **Persistence.** Must unsent drafts survive an app restart, and should
   they stay attached when the file changes underneath them (re-anchor), or
   is it fine to drop/orphan them? — **Persist + re-anchor.** Unsent drafts
   survive restarts; when the file changes they re-anchor to the matching
   text/line, and ones that can't be placed show as orphaned.
4. **After send.** Are sent comments cleared, or kept as a visible history
   (e.g. "sent at …") on the diff/artifact? — **Kept, hidden by default.**
   Sent comments go to a collapsed "Sent" list in the session's tray, with
   when they were sent. They are not shown inline and are not re-anchored.
5. **HTML artifacts.** Comments on HTML artifacts (the sandboxed iframe) in
   this feature, or later? — **Later.** Markdown artifacts and diff lines
   only; HTML comments are a follow-up.
6. **Other targets.** Besides diff lines and markdown artifacts, should
   project files opened in the viewer (the `~file` route), or a general
   unanchored note, be commentable in this feature? — **General note only.**
   One unanchored note can go with each send. Project files opened through
   the `~file` route are not commentable in this feature.

## Size verdict

**M.** Clear result and familiar modules (viewer, diff, tmux backend, state
slices), but several user-visible pieces — commenting in the diff, commenting
in markdown, the tray, and sending — and a few one-way decisions (send path,
anchor model, persisted shape). Likely within `limits.maxOneWayDecisions` (8)
and ≤ 8 slices.

**Proposed flow: standard** — size M; design and slices fit one review, as
with `2026-10-07-session-diff`.

## Open questions
