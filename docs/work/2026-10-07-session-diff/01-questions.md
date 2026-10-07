---
phase: questions
status: approved
version: 1
based_on: 00-ticket.md
---

# Session diff

## Goal

Show the git diff of a session's working directory in the Claude Code app,
so the human can see what changes a session made alongside the session's
terminal output.

## Out of scope

- Per-session diffs: worktrees per session so parallel sessions don't share
  one diff. Will be addressed in a later phase.
- Comments on diffs: anchoring and sending comments to a session. That is
  `2026-10-07-review-comments`.
- Diff rendering UX polish: syntax highlighting, collapsible sections, etc.
  Ship minimal; iterate later.

## Research questions

1. How does the session viewer currently display session information
   (terminal output, status, metadata)?

2. How are a session's working directory and git integration currently
   handled (checkout location, worktree usage if any)?

3. What git diff tools or libraries does the codebase currently use, if any?

4. How does the renderer currently refresh and update when a session's state
   changes (new output, status change)?

5. How are artifacts currently displayed to the user (artifact viewer panel,
   tabs, inline)?

6. What is the current session/feature linking logic (how does a session know
   which feature folder it writes into)?

7. How does the app currently handle sessions that run in directories without
   a git repo?

## Product questions for the human

1. **Diff base:** `HEAD` (whatever commit is currently checked out). Standard
   behavior; more base options (merge-base, session start commit) can be
   added later.

2. **Untracked files:** Yes, include them by default. Provide a toggle to hide
   them if the human prefers a cleaner view.

3. **UI placement and access:** The diff appears in the right-hand artifact
   viewer (like artifacts today), not as a permanent split-panel. Provide a
   keyboard shortcut (Cmd+Option+B) to quickly toggle to the diff view.

4. **Non-git sessions:** Show an empty/disabled state if the session runs in a
   directory without a git repo.

## Size verdict

**M (Medium).** Reasons:
- Spans 2–3 files: session status code, renderer display code, possibly a
  diff compute utility.
- Several product decisions needed on base, untracked files, UI placement,
  and refresh logic — typical for feature design.
- One main workflow artifact (the diff view itself).
- Known pattern: compute git diff, display as text, refresh on session event.
- No one-way decisions; all are revisable or backwards-compatible.

**Proposed flow: standard.** Size M with product design ahead; research will
answer where the code points us.

## Open questions

(None yet; awaiting product answers above.)

## Flow log

- 2026-10-07: standard (proposed from size M)
