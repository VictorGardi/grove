Source: the human's remarks on 2026-10-07, verbatim, followed by the
decisions they chose in that conversation.

## Request (verbatim)

"i want to start with sessions for opencode and claude code, autolinking to feature (based on docs/work dir), see diff from a session + possible to add comments to files and pass back to that session."

On how to compute the diff: "3, git diff sessions working directory - but then we need to add worktrees but that is ok for later. go"

## Decisions chosen

1. The diff is the `git diff` of the session's working directory, not a
   per-session record of the agent's own edits.
2. Worktrees per session are needed later so parallel sessions don't share one
   diff. Out of scope here.

## Open for the questions phase

- Base of the diff: `HEAD`, the branch's merge-base with the main branch, or
  the commit the session started on.
- Untracked files: included or not.
- Where the diff is shown (a panel next to the terminal, the right-hand
  viewer, its own tab) and how it refreshes while the agent works.
- How a session that isn't in a git repo is shown.
- Diff rendering library, given comments will be anchored on diff lines in
  `2026-10-07-review-comments`.
