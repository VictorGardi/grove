Source: the human's remarks on 2026-10-06 and 2026-10-07, verbatim, followed
by the decisions they chose in that conversation.

## Request (verbatim)

"what i really want is a simply way to see artifacts from sessions in a markdown viewer where i can add comments (multiple) and pass back to agent.."

"i want to start with sessions for opencode and claude code, autolinking to feature (based on docs/work dir), see diff from a session + possible to add comments to files and pass back to that session."

## Decisions chosen

1. Comments can be added to files: lines in the session diff and text in
   markdown artifacts.
2. Several comments are collected, then passed back to that session together.
3. This replaces epic child 6 (artifact comments) and does not wait for child 5
   (next actions); it builds its own send path.

## Background

- ADR 0008 (in-app inline comments) and the epic design's E-D7–E-D9 describe
  comment drafts, quote anchors and the review tray for artifacts. Reuse what
  still fits.
- `CONTEXT.md` already defines **Comment draft** and **Review tray**.

## Open for the questions phase

- Send path: bracketed paste into the session's tmux pane, or something
  agent-specific (OpenCode's server, Claude Code's input), and what happens if
  the session is working or gone.
- Message format the agent receives (file, line or quote, comment).
- Whether drafts survive app restarts and re-anchor after the file changes.
- Comments on HTML artifacts (ADR 0007's sandboxed iframe) now or later.
