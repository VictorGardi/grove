# 0021. Session diff: git CLI, parsed in core, pushed as a slice, drawn in React

Date: 2026-10-07

## Status

Proposed

## Context

A session's diff (`2026-10-07-session-diff`, ADR 0020 step 3) is the
`git diff HEAD` of its working directory plus untracked files. It must stay
current while the agent works, and `2026-10-07-review-comments` will anchor
comments on its lines. The app ran no git commands before (`git.ts` reads
`HEAD` files), and the viewer only showed sandboxed iframes (ADR 0007).

## Decision

Core spawns the system `git` CLI (`execFile`, found like tmux,
`GIT_OPTIONAL_LOCKS=0`, 10 s timeout) and parses the unified diff once into a
structured `SessionDiff` → `DiffFile` → `DiffHunk` → `DiffLine` with old/new
line numbers. A line's identity is `(path, side, number)`. Core holds only the
diff on screen in a `diff` slice (ADR 0011), recomputed while the viewer shows
a diff and pushed only when git's output changed. The renderer draws it with a
React component in the viewer panel, as text nodes. Changed viewable files open
rendered in the existing iframe viewer instead of as a rendered diff.

## Consequences

- The diff matches the terminal's `git diff` (gitignore, attributes, renames).
  Git must be installed.
- Review comments build on a typed line identity; no second parser.
- Git runs only while a diff is open; one diff exists at a time.
- Diff lines and rendered documents are two views with two anchor kinds (line
  vs. quote, ADR 0008).
- Rejected: `simple-git` (a dependency over the same binary); `isomorphic-git`
  (no renames, ignores git config, can disagree with the terminal); raw diff
  text parsed in the renderer (every consumer re-parses); invoke-and-pull
  (rejected by ADR 0011); a diff per live session (N git runs per tick);
  diff HTML in the sandboxed iframe (reload per change, postMessage for
  interaction, nothing to contain).
