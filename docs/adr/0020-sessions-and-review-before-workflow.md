# 0020. Sessions and review come first; new workflow features are on hold

Date: 2026-10-07

## Status

Accepted

## Context

The epic `2026-10-05-opencode-feature-workspace` puts a workflow at the centre
of the app: stage timelines, a feature board with one column per stage, card
states, and next-action buttons that walk a feature through `workflow.yaml`
(ADR 0002). Children 1, 9, 2, 3 and 4 are built. Before starting next actions
(child 5), the human found the app was gaining workflow features too early.
What they use every day is smaller: sessions for OpenCode and Claude Code, each
session auto-linked to the feature folder it writes into, a view of what a
session changed, and comments on those changes sent back to that session.

## Decision

The app is built around sessions and review first. The order is:

1. **Sessions board by default**: the workflow UI that is built stays (the
   Features board, stage timeline, card states), but going to a project page
   from the sidebar, a breadcrumb or ⌘B always lands on its Sessions board.
   The Features | Sessions switch still flips it there. This narrows ADR
   0018's persisted board choice: it lasts only while on the page.
2. **Claude Code sessions** (epic child 10, unchanged).
3. **Session diff** (`2026-10-07-session-diff`): the `git diff` of the
   session's working directory. Its base and whether untracked files count
   are left to that feature's design.
4. **Review comments** (`2026-10-07-review-comments`): several comments on
   diff lines and on markdown artifacts, collected in a tray and sent together
   to one session as a single message.
5. **Packaging** (epic child 8).

Epic children 5 (next actions) and 7 (command palette and grid) are on hold.
Child 6 (artifact comments) is superseded by review comments, which covers
diffs as well as artifacts and does not depend on child 5. The new work runs
as standalone features, like `2026-10-06-project-page`, so the epic's approved
design and structure are not reopened.

## Consequences

- The diff is per working directory, not per session. Two sessions sharing a
  checkout see each other's changes in one diff. Worktrees per session are the
  planned fix, later and out of scope here.
- Sending comments needs its own send path (typing into the session's tmux
  pane), which child 5 was to build. Review comments builds it instead.
- The built workflow UI stays and is kept working, but gets no new features.
  ADR 0002 still governs discovery and stages.
- The epic's `03-design.md` and `04-structure.md` (v6) still list children 5–7
  as planned. The epic's `feature.md` records the re-scope.
- Rejected: a per-session diff from OpenCode's session diff and Claude Code's
  write hooks (more precise, but harder to make the same for both agents);
  hiding or deleting the workflow UI (it already works and costs little to
  keep); a herdr plugin plus an external reviewer (the viewer is the real work
  either way, and herdr was already rejected in ADR 0003).
