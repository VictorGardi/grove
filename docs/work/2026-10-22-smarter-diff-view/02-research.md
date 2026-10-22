---
feature: 2026-10-22-smarter-diff-view
phase: research
status: approved
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: []
forced: []
repo_heads:
  - 08ad2e723b8df2595b7805c5c308c260a0edcb7b
---

# Research: session diff view today

Facts only. Paths under `src/`.

## Shapes (`shared/types.ts`)

- `DiffTarget { kind:'diff'; sessionId; base?: string|null }` (:47). `base` is a local branch name; null/unset = working tree vs HEAD. Lives in `UiState.viewer`, which is persisted (survives restart).
- `SessionDiff { sessionId; projectId; state:'ok'|'not-git'|'error'; error; root; files:DiffFile[]; truncated; base }` (:51). `base` echoes the requested base, not a SHA.
- `DiffFile { path; oldPath; status; binary; additions; deletions; hunks; truncated; rendered }`, `DiffHunk`, `DiffLine` (:61-74).
- Comment anchor (diff variant): `{kind:'diff'; root; path; side; start; end; lines[]}` (:137). No base in the anchor.
- Only two bases exist: none (working tree vs HEAD) and one local branch (diffed from `merge-base(branch, HEAD)`). No commit, SHA, upstream or remote bases.

## Opening the diff

- Header "Diff" button (`renderer/App.tsx:211`), menu "Session Diff" `CmdOrCtrl+Alt+B` (`main/menu.ts:62`), palette item "Session diff" (`paletteItems.ts:32`), review-tray quote click, "← Diff" from a rendered file.
- `openDiff(id)` and `backToDiff(id)` write `viewer:{kind:'diff', sessionId}` with no base (`stores/slices.ts:100-111`), so every open resets to "Working tree". The chosen base is not remembered per session or project.

## Default view and the empty state

- Default base is null: `git diff HEAD -M ...` plus untracked files (`core/diff/compute.ts:34`). With all work committed and a clean tree the diff is empty (test `compute.test.ts:188`).
- Empty state is the plain text "No changes" (`DiffViewer.tsx:217-227`), with no hint about the base. Other states: "Loading…", "Not a git repository", error text, "Diff too large" notice.

## Base picker

- Native `<select aria-label="Diff against">` (`DiffViewer.tsx:150-158`): "Working tree" plus one optgroup "Since branched from" listing every branch. No search, filter, grouping or recents.
- Data from IPC `diff:refs {sessionId}` → `{branches:string[]; default:string|null}` (`shared/ipc.ts:32`, impl `core.ts:1041-1054`), fetched once per mount/session (`DiffViewer.tsx:41`).
- `listBranches` (`core/diff/git.ts:28`) = `git for-each-ref refs/heads/`: local branches only, includes the current branch, no remotes. The renderer sorts default first, then `localeCompare` (`DiffViewer.tsx:44`).
- `listBases` (`git.ts:39`) includes `origin/*` but is used only by the new-worktree dialog (`repoRefs`, `core.ts:802`).

## Default branch, merge-base, upstream

- `defaultBranch` (`git.ts:52-66`): `origin/HEAD` short name with `origin/` stripped, else local `main`, else `master`, else null. May name a branch that has no local ref.
- `mergeBase` (`git.ts:70`): `git merge-base <ref> HEAD`, null on failure. `compute.ts:36`: no merge-base falls back to diffing against the ref itself; a nonexistent ref gives state `error`. `worktrees.resolveBase` (`worktrees.ts:57`) tries `base` then `origin/base`; the diff path does not.
- No upstream (`@{u}`) detection anywhere in the diff code. Worktree creation records no parent branch in a form the diff reads.

## Computation and refresh

- `computeDiff` (`compute.ts:20`): `rev-parse --show-toplevel`, `git diff <against>`, `ls-files --others`, untracked files read (first 200, ≤1 MiB, no binary), `parseUnifiedDiff`, capped at 20 000 lines. Cache key = sha1 of base, against, raw diff and untracked stamps.
- Computed only while a diff viewer is open. No fs watcher: refreshed by the 5 s tick, agent `wrote` events and `exec-ended` (`core.ts:429, 602, 607`). `syncDiff` pokes on base change.
- `diffLines` expands unmodified gap lines from the working tree only (not from the base).
- Project path may be a subtree of the repo; `projectScope` adds `-- <rel>`.

## Diff UI controls

- Header: `Diff · label`, base select, "Untracked" eye toggle, n/N pager with prev/next, review comments menu, expand and close buttons.
- File list: "Filter files…" (⌘F), directory tree with collapsible dirs, per-file status letter and +/−. No overall totals.
- One file shown at a time; no scroll-through of all files, no per-file collapse, no "viewed" marks.
- Split vs unified is tied to the viewer's expanded flag (`ui.viewerExpanded`), not a toggle. Word-level marks and gap expansion exist.

## Comments and a base change

- A base change triggers recompute then `reanchorDiff` (`core/comments/anchor.ts:42`): drafts re-match by line text on the same side within the new hunks; absent lines orphan the comment, and it recovers if the lines return. No per-base bookkeeping.

## Tests and commands

- Vitest, node env, `src/**/*.test.ts`. Real-git fixtures in `core/testing/gitRepo.ts`. Base cases `core/diff/compute.test.ts:188-240`; `core/diff/core.test.ts:116-158`; `watch`/`parse` tests; renderer pure-function tests `diffView.test.ts`, `reviewView.test.ts`, `sessionDiffShortcut.test.ts`.
- No tests for `listBranches`, `listBases`, `defaultBranch`, `mergeBase` directly, nor for the base picker, `setDiffBase`, `openDiff` or the empty state.
- One file: `npx vitest run <path>`. Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.

## Open questions
