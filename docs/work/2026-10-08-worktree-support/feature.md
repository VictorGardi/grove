---
kind: feature
created: 2026-10-08
flow: standard
---

# Worktree support

Let a session run in its own `git worktree` instead of always sharing its
project's single checkout, so concurrent agent sessions on the same repo stop
colliding on one working directory/branch. Flagged as future work in
[ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md) and the
`2026-10-07-session-diff` research ("Worktrees per session are needed later
so parallel sessions don't share one diff").

## Flow log

- 2026-10-08: standard (size M, investigation only — no questions phase run yet)
- 2026-10-08: standard (size M, questions phase complete — modeling: plain Session.cwd; CLI-only v1; keep-until-merged; hidden cache dir; --branch as-is; auto submodule update)
