Source: the human's remarks on 2026-10-08, verbatim.

## Request (verbatim)

"i want to investigate how we can allow grove to work in worktrees. use
sonnet subagents to explore and understand best practices. how complex is it
to add worktrees and handling them in the app?"

## Decisions chosen

None — this was an investigation only, no product decisions were made. See
`02-research.md` for findings and `01-questions.md` (not yet written) for the
product questions a real questions phase would need to resolve, e.g.:

- Should a worktree session be modeled as its own `Project` (grouped under its
  parent repo) or stay a plain `Session.cwd` under the existing project?
- Auto-create a worktree on a new branch vs. always ask the user first?
- Cleanup policy on session end: auto-remove, keep-until-merged, or manual
  only?
- Where do new worktrees live on disk (sibling directory, hidden cache dir)?
- Does the GUI need its own "start session in new worktree" flow, or is a CLI
  flag (`grove new --worktree`) enough for a first cut?
