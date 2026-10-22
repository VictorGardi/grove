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

## Slice 5

Session: smarter-diff-view-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `DiffViewer.tsx` worded the on-main and no-main notes inline and showed a bare "No changes" for every empty diff; `DiffCompared` already carried `onDefault`, `noDefault`, `noOwnCommits`; `setDiffMode` is the existing view switcher.

Implementer 1:
- [x] `src/renderer/src/diffView.ts`: pure `branchNote(compared)` and `emptyMessage(compared, mode)` returning text and the quick-switch target
- [x] `src/renderer/src/components/DiffViewer.tsx` and `.module.css`: notes from `branchNote`, empty state with a switch button
- [x] tests in `src/renderer/src/diffView.test.ts`

Models passed: reviewer: inherit

### Review rounds

Round 1: no blocking findings; applied non-blocking: hint when only untracked files are hidden, `flex-wrap` on the note, two extra tests (no `compared`, Uncommitted only on main).

approved, 0 blocking, 0 fix rounds. Non-blocking left: empty Branch view on an unchanged branch offers Last commit, which is also empty (a dead end, the plan only asks for a sensible switch); "No commits to show." for an empty Last commit not on a fresh branch is worded by the planner, not the brief.

### Deviations

The planner session wrote the code itself instead of delegating to an implementer subagent (small, tightly coupled slice). `branchNote` was added beside `emptyMessage` to word the notes in one place, and the on-main note now ends with a period as in the brief. Otherwise none.

### Verification

`npx vitest run src/renderer/src/diffView.test.ts` 29 passed (new: the three brief messages, quick-switch targets, on-main and no-main notes, notes only for the default pick); `npm test` 1154 passed; `npm run typecheck` clean. Reviewer requested with model inherit.

### Left for the human

Observable check in `npm run dev`: on an unchanged branch the Branch view shows "No changes on this branch compared to main." with a switch button; Uncommitted only on a clean tree shows "No uncommitted changes."; Last commit on a fresh branch shows "No commits on this branch yet."; on main the note reads "You are on main; showing uncommitted changes only." Check the message and button layout in light and dark.

## Final summary

- Slice 1: `2026-10-22-smarter-diff-view: slice 1 — Opening the diff after a commit shows the branch's work`: core resolves the main branch and the diff opens on branch work plus uncommitted edits. Review: approved, 0 fix rounds. Deviations: none beyond the planner writing the code itself.
- Slice 2: `slice 2 — Switch between the three views`: segmented Branch / Uncommitted only / Last commit switch. Review: approved, 0 fix rounds. Deviations: as slice 1.
- Slice 3: `slice 3 — The choice is remembered for the session`: per-session `diffPrefs`. Review: approved, 0 fix rounds. Deviations: optional `diffPrefs` left absent in defaults.
- Slice 4: `slice 4 — Short smart list with search`: popover picker with default, recents and local/remote search. Review: approved, 0 fix rounds. Deviations: `recentBases` pruned in `forgetProjectUi`.
- Slice 5: `slice 5 — Clear empty states and notes`: specific empty messages with quick switches and the on-main and no-main notes in one place. Review: approved, 0 fix rounds. Deviations: `branchNote` added.

### Left for the human

Run `npm run dev` and walk the "How I'll know it works" list of `01-outcome.md`: commit and open the diff; the three views; the picker with many branches and a remote-only name; reopen keeps the choice and a new session starts at defaults; empty states; on-main note; comments, file tree and split/unified unchanged. Check the segmented switch, picker popover and empty states in light and dark.

### PR description

Smarter diff view: branch work by default, three views, short branch picker

The session diff now opens on everything the branch changed since it split from the detected main branch, committed and uncommitted together. A segmented switch offers Branch + uncommitted, Uncommitted only and Last commit. The compare-against control is a popover with the main branch, recently picked branches and a search over local and remote branches. The view and branch are remembered per session. Empty cases say why nothing is shown with a quick switch, and the on-main and no-main notes are worded in one place.

Slices: 1 default branch view and `compared` info from core; 2 view switch and last commit; 3 per-session `diffPrefs`; 4 picker with recents and remote search; 5 empty states and notes. Verified with `npm test` (1154 passed) and `npm run typecheck`; comments, file tree and split/unified display are unchanged. Left for the human: the visual checks in `npm run dev`, in light and dark.

## Open questions
