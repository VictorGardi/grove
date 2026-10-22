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

## Slice 2

Session: smarter-diff-view-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `computeDiff` resolved the default base only for 'branch' mode and always read untracked files; the header had a `<select>` mixing views and branches; `setDiffBase` was the only viewer writer.

Implementer 1:
- [x] `src/core/diff/compute.ts`: 'last-commit' mode (HEAD vs parent or empty tree, tracked only, empty when `noOwnCommits`)
- [x] `src/renderer/src/stores/slices.ts`: `setDiffMode`
- [x] `DiffViewer.tsx`, `.module.css`: segmented switch, base select only in Branch, Untracked toggle hidden in Last commit
- [x] tests in `compute.test.ts` and `src/core/comments/reanchor.test.ts`

Models passed: reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking left (roundabout `compared.base` reset in last-commit, merge commits diff against first parent untested, empty Last commit has no message until slice 5).

approved, 0 blocking, 0 fix rounds. Non-blocking left: see round 1.

### Deviations

The planner session wrote the code itself instead of delegating to an implementer subagent (small, tightly coupled slice). Otherwise none.

### Verification

`npx vitest run src/core/diff/compute.test.ts src/core/comments` 86 passed (new: last commit newest only, root commit, on main, HEAD equals merge-base, no commits, mode-only key change, comment orphaned on mode switch); `npm test` 1133 passed; `npm run typecheck` clean. Reviewer requested with model inherit.

### Left for the human

Observable check in `npm run dev`: add an uncommitted edit; Branch shows commits plus the edit, Uncommitted only shows the edit, Last commit shows the newest commit. Check the segmented switch visually in light and dark.

## Slice 3

Session: smarter-diff-view-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `openDiff` and `backToDiff` in `slices.ts` wrote a bare `{kind:'diff', sessionId}` viewer, so the choice was lost on every reopen; `setDiffBase` and `setDiffMode` wrote only `ui.viewer`; `loadState` pruned `ui.viewer` and the grid by known session ids; `uiSet` shallow-merges.

Implementer 1:
- [x] `src/shared/types.ts`: `DiffPrefs`, optional `UiState.diffPrefs` (no schema bump, `DEFAULT_UI` untouched)
- [x] `src/core/store/stateStore.ts`: prune `diffPrefs` with the sessions on load
- [x] `src/renderer/src/diffView.ts`: pure `diffTargetFor` and `pickDiffPrefs`
- [x] `src/renderer/src/stores/slices.ts`: `openDiff`/`backToDiff` read the prefs; `setDiffBase`/`setDiffMode` write viewer and prefs through one `pickDiff`
- [x] tests in `stateStore.test.ts` and `diffView.test.ts`

Models passed: reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking left: two picks inside one IPC round trip could read stale prefs, prefs of a session deleted at runtime stay until the next load, no test of the close-and-reopen flow itself (the pure helpers are tested).

approved, 0 blocking, 0 fix rounds. Non-blocking left: see round 1.

### Deviations

The planner session wrote the code itself instead of delegating to an implementer subagent (small, tightly coupled slice). Optional `diffPrefs` is left absent in `DEFAULT_UI` and read as empty, rather than defaulted to `{}` on load, so an old state file round-trips unchanged. Otherwise none.

### Verification

`npx vitest run src/core/store src/renderer` 381 passed (new: prefs of a deleted session dropped on load, old file without prefs, no prefs opens on defaults, prefs open on their view and branch, picking keeps the unpicked part, default re-pick stores null); `npm run typecheck` clean. Reviewer requested with model inherit.

### Left for the human

Observable check in `npm run dev`: pick Uncommitted only, close and reopen the diff, it is still Uncommitted only; open another session's diff, it is Branch.

## Open questions
