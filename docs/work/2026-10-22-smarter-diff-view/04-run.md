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

## Slice 4

Session: smarter-diff-view-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `diffRefs` returned local branch names only (`listBranches`) and the default; the header used a native `<select>` over all local branches; `ui:set` shallow-merges `UiState`; `stateStore.loadState` has no projects, which `forgetProjectUi` in `core.ts` prunes `ui` by.

Implementer 1:
- [x] `src/core/diff/git.ts`, `src/core/core.ts`, `src/shared/ipc.ts`: `diffRefs` returns `listBases` (local and remote, no `*/HEAD`), `current` and `default`; unused `listBranches` removed
- [x] `src/shared/types.ts`, `src/core/core.ts`: optional `UiState.recentBases`, pruned for removed projects in `forgetProjectUi`
- [x] `src/renderer/src/diffBases.ts`: pure `baseChoices` and `pushRecentBase` (cap 5)
- [x] `src/renderer/src/components/BasePicker.tsx` and `.module.css`: popover with search, keyboard handling, refs read on open; `DiffViewer.tsx` uses it, `.baseSelect` CSS removed
- [x] `src/renderer/src/stores/slices.ts`: `pickDiff` records a non-default picked base in the project's recents
- [x] tests: `diffBases.test.ts`, `core/diff/core.test.ts`, `core/projectUi.test.ts`

Models passed: reviewer: inherit

### Review rounds

Round 1: no blocking findings; applied non-blocking: no empty-state flash before the branch list arrives, `origin/<default>` no longer listed beside the default.

approved, 0 blocking, 0 fix rounds. Non-blocking left: `recentBases` written from a store snapshot (two near-simultaneous picks could overwrite each other), a recent that is only `origin/<current>` is not excluded, a hand-edited non-array `recentBases` is not sanitised on load, key handling only while the search input has focus.

### Deviations

The planner session wrote the code itself instead of delegating to an implementer subagent (small, tightly coupled slice). Pruning of `recentBases` lives in `forgetProjectUi` (`core.ts`), not `stateStore.ts`, because the state file holds no projects; its test is in `projectUi.test.ts`, and the write path (cap 5, no duplicates) is covered by the pure `pushRecentBase` test in `diffBases.test.ts`, not `stateStore.test.ts`. "Keyed per project" is covered by the pruning test only.

### Verification

`npx vitest run src/renderer src/core/diff` 420 passed (new: empty query default then capped recents, current branch excluded, case-insensitive local and remote search, default listed once, `diffRefs` with remote branches, diff against a remote-only `origin/release`, recents pruned on project removal and at start); `npm test` and `npm run typecheck` clean. Reviewer requested with model inherit.

### Left for the human

Observable check in `npm run dev`: in a repo with many branches the picker lists only main and recents until you type; type a remote branch name and pick it. Check the popover visually in light and dark.

## Open questions
