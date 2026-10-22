---
feature: 2026-10-22-smarter-diff-view
phase: run
status: draft
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at:
based_on: [03-plan.md@3]
forced: []
---

# Run: smarter diff view

Profile: inherit
Branch: feature/2026-10-22-smarter-diff-view-inherit
Plan commit: 272c1fbd750ed9fcda3de67626940b61e6dae36f
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: smarter-diff-view-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `computeDiff` took only an optional `base` and diffed against HEAD without one; `runDiff`/`syncDiff` in `core.ts` read `base` off `ui.viewer`; `defaultBranch` in `git.ts` returns a name only; the header `<select>` offered "Working tree" plus all local branches.

Implementer 1:
- [x] `src/shared/types.ts`: `DiffMode`, `mode` on `DiffTarget`, `DiffCompared` and `compared` on `SessionDiff`
- [x] `src/core/diff/git.ts`: `resolveDefaultBase`, `currentBranch`
- [x] `src/core/diff/compute.ts`: mode/base resolution, `compared`, key
- [x] `src/core/core.ts`: `runDiff`/`syncDiff` pass and watch mode
- [x] `DiffViewer.tsx`, `slices.ts`: "Uncommitted only" option, default label, notes
- [x] tests in `compute.test.ts`, `core.test.ts`, fixtures updated

Models passed: reviewer: inherit

### Review rounds

Round 1: no blocking findings; applied non-blocking: unborn HEAD counts as `noDefault`, select value normalised when a persisted base equals the default, label falls back to `compared.defaultBase`.

approved, 0 blocking, 0 fix rounds. Non-blocking left: extra git spawns per recompute; explicit base on the default branch never sets `noOwnCommits` (per plan).

### Deviations

The planner session wrote the code itself instead of delegating to an implementer subagent (small, tightly coupled slice). Otherwise none.

### Verification

`npx vitest run src/core/diff` 59 passed (new cases: branch work with no base, on main, origin/<name> fallback, no main, missing ref, detached HEAD, uncommitted ignores base); `npm test` 1126 passed; `npm run typecheck` clean. Reviewer requested with model inherit.

### Left for the human

Observable check in `npm run dev`: commit in a worktree session, open the diff, see the commit's files without choosing a branch.

## Open questions
