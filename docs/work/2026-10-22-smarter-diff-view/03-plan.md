---
feature: 2026-10-22-smarter-diff-view
phase: plan
status: approved
version: 3
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: smarter diff view

## Decisions

### D1. How a diff view is described and how the default is found

**Context.** Today the diff target carries only an optional branch name (`DiffTarget.base`), and "no base" means uncommitted only. The brief needs three views (Branch + uncommitted, Uncommitted only, Last commit), and the default must be the new Branch view with the main branch found automatically. The shape chosen here is persisted in the UI state and read by core, so it is hard to change later.

**Options.**
- A. Add a `mode` field (`branch` | `uncommitted` | `last-commit`) next to the existing `base`. A missing `mode` means `branch`. In `branch` mode a missing `base` means "auto-detected main branch", resolved by core on every compute; an explicit `base` overrides it. Pros: small change to existing shapes and the existing merge-base compute is reused as is; old persisted viewers upgrade without migration (an old viewer with an explicit `base: <branch>` keeps that base and opens as Branch against it). Cons: an old persisted viewer that meant "uncommitted only" opens as Branch once.
- B. Replace `base` with a tagged union of views (`{kind:'branch', base?}`, `{kind:'uncommitted'}`, `{kind:'last-commit'}`). Pros: impossible states cannot be represented. Cons: touches every reader of `base` (renderer, core, tests) and needs a migration of persisted state.
- C. Keep `base` only and encode the views as special strings. Pros: no type changes. Cons: magic strings that can collide with real branch names.

**Pick:** A

**Outcome impact.** The diff opens on the branch view with no clicks. Nothing else changes for the human, apart from one first open after upgrading that lands on Branch instead of a stale uncommitted-only choice.

### D2. Which ref counts as "the main branch", and the on-main case

**Context.** The branch view compares against the project's default branch. The existing detection (`origin/HEAD`, else local `main`, else `master`) can return a name with no local ref, and the diff path does not fall back to `origin/<name>` the way worktree creation does. The brief also says: on the main branch itself show only uncommitted changes with a note, and when no main is found let the human pick via search.

**Options.**
- A. Use the existing `defaultBranch`, resolved to the local branch if it exists, else `origin/<name>`; core reports `onDefault` (HEAD is that branch) and `noDefault` (nothing detected) in the diff result. On the default branch the view compares against HEAD (uncommitted only) and is labelled so. An explicit branch pick overrides that fallback. Pros: reuses tested detection; a stale local main is harmless because the diff starts from the merge-base; no network. A detected name with neither a local ref nor `origin/<name>`, and a detached HEAD, both report `noDefault` rather than a diff error, and the Branch view then falls back to HEAD (uncommitted only). An explicit `base` is ignored in `uncommitted` and `last-commit` modes, so `setDiffMode` need not clear it. Cons: if the project's real target is something other than main/master (a release branch) the default is wrong until the human picks one, and the pick is remembered for that session only.
- B. Detect the branch's upstream (`@{u}`) and use it when it exists, else A. Pros: handles stacked or release branches. Cons: an upstream of the branch itself (`origin/feature`) is usually the branch's own remote copy, so it would show an empty diff in the common case; needs extra rules.
- C. Always use the remote `origin/<default>`. Pros: matches what a PR shows. Cons: fails for repos with no remote and compares against a ref that may be older than local main.

**Pick:** A

**Outcome impact.** Committed work shows at once for the usual main/master repos, with no network. Repos whose target is something else need one pick per session.

### D3. Where the per-session choice is kept

**Context.** The brief says a picked branch and view are remembered for the session, and a new session starts at the defaults. Today the base lives inside the single global viewer (`ui.viewer`), which `openDiff` and `backToDiff` reset, so the choice is lost on every reopen.

**Options.**
- A. A new `ui.diffPrefs` map keyed by session id, `{mode, base}`, written when the human picks and read when the diff opens. Pruned with the session like `ui.viewer` already is. Pros: survives close and reopen, and also a restart of the same session; new sessions have no entry so they use defaults. Cons: one more field in the persisted UI state.
- B. Keep it only in the in-memory renderer slice. Pros: no persisted state. Cons: lost on app restart, and core, which computes the diff, would need the choice pushed to it on every open.
- C. Keep it inside `ui.viewer` and stop resetting it in `openDiff`. Pros: no new field. Cons: opening a different session's diff replaces the viewer and loses the first session's choice.

**Pick:** A

**Outcome impact.** Reopening the diff in the same session keeps the branch and view; another session is unaffected.

### D4. Recently used branches: scope and storage

**Context.** The picker lists "branches recently picked in this project" under the main branch. A project here is one path, and each worktree is its own project (ADR 0037), so the scope decides whether a worktree sees its parent's recents.

**Options.**
- A. `ui.recentBases`, a map from project id to at most 5 branch names, most recent first, written when the human picks a branch other than the default. Pros: matches the brief's wording; trivial. Cons: a new worktree project starts with no recents.
- B. Key by repo group (projects sharing one git common dir). Pros: recents carry across a repo's worktrees. Cons: needs the group lookup in the pick path and goes beyond "in this project".
- C. Derive recents from git (recently checked-out branches from the reflog). Pros: no stored state and picks up work done outside grove. Cons: reflog can be empty or noisy, and it is not what the human picked in the diff.

**Pick:** A

**Outcome impact.** The short list holds the few branches the human actually compared against in that project; a new worktree starts with just the main branch.

### D5. The picker control

**Context.** The native `<select>` cannot search or group, and the brief requires a short list plus a search box that also finds remote branches.

**Options.**
- A. A custom popover (button showing the current target, a search input, a short list), with the full branch list (local and remote) fetched once when it opens and filtered on the client. With an empty query only the default, the current choice and recents are shown. Pros: matches the brief; one fetch; testable pure filter function. Cons: new component with keyboard handling to build.
- B. Keep the native `<select>` and drop the branch list down to default plus recents, adding a separate "Other branch…" prompt. Pros: very little UI work. Cons: a second dialog for the rare case, which is the friction the human complained about.
- C. Reuse the launch palette component for search. Pros: consistent look. Cons: the palette is built for sessions and launch targets and would need generalising.

**Pick:** A

**Outcome impact.** One click shows the few useful choices; typing finds any branch, remote ones included.

## Slices

### Slice 1. Opening the diff after a commit shows the branch's work

**Outcome.** Opening a session diff with committed work and a clean tree shows the branch's changes against the detected main branch, plus any uncommitted edits, and the header names what it is compared against. On the main branch it shows only uncommitted changes with the note.
**Thin end-to-end:** UI (`DiffViewer` opens with no choice, so `ui.viewer` carries no `mode` and no `base`) -> `ui:set` -> `syncDiff` -> core `runDiff` reads `mode` and `base` from `ui.viewer` and resolves the default base -> `computeDiff` -> `state:diff` -> header label and on-main note. Until slice 2 the select's "Working tree" option is relabelled "Uncommitted only" and sets `mode: 'uncommitted'`, so that view stays reachable. Deliberately missing: the full view switch, last commit, per-session memory, new picker, recents, new empty-state wording.
**Files.** `src/shared/types.ts` (add `mode` to `DiffTarget`; add `compared` to `SessionDiff`: `{mode, base, defaultBase, onDefault, noDefault, noOwnCommits}`, where `noOwnCommits` is core-computed: HEAD equals the merge-base with the compared branch, and false when `onDefault`, so Last commit on main shows main's latest commit), `src/core/diff/git.ts` (a `resolveDefaultBase` helper that returns the local ref or `origin/<name>`), `src/core/diff/compute.ts`, `src/core/core.ts` (`runDiff`), `src/renderer/src/components/DiffViewer.tsx`, tests `src/core/diff/compute.test.ts`, `src/core/diff/core.test.ts`.
**Verification.** `npx vitest run src/core/diff` passes with new cases: a repo with a feature branch whose work is all committed returns that work with no base given; on `main` it returns only uncommitted changes with `onDefault` true; a repo with no main/master, a detected default with no local or `origin/` ref, and a detached HEAD each return `noDefault` true with state `ok`, not `error`. Then `npm run typecheck`. Observable: `npm run dev`, commit in a worktree session, open the diff, and the commit's files are listed without choosing a branch.

### Slice 2. Switch between the three views

**Outcome.** A view switch in the diff header offers Branch + uncommitted, Uncommitted only and Last commit, and each shows the right changes.
**Files.** `src/core/diff/compute.ts` (last-commit: HEAD against its parent, or the empty tree for a root commit, no untracked files; empty when `noOwnCommits`, so an unchanged branch does not show main's latest commit), `src/renderer/src/stores/slices.ts` (`setDiffMode`), `src/renderer/src/components/DiffViewer.tsx` and `DiffViewer.module.css` (segmented switch; the "Untracked" eye toggle is hidden in Last commit), tests in `src/core/diff/compute.test.ts`.
**Verification.** `npx vitest run src/core/diff/compute.test.ts src/core/comments`: a mode switch reanchors a draft comment in `src/core/comments/reanchor.test.ts` (orphaning it when its lines are not in the new view); last-commit returns only the latest commit's files, handles a root commit, returns no files when HEAD equals the merge-base with main, and the cache key changes when only the mode changes. `npm run typecheck`. Observable: add an uncommitted edit; Branch shows commits plus the edit, Uncommitted shows only the edit, Last commit shows only the newest commit.

### Slice 3. The choice is remembered for the session

**Outcome.** A picked view and branch stay when the diff is closed and reopened in the same session, and a new session starts at the defaults.
**Files.** `src/shared/types.ts` (`UiState.diffPrefs`; on open, `diffPrefs[sessionId]` fills `ui.viewer`'s `mode` and `base`, and `ui.viewer` stays the single source core reads, so there is one writer path; re-picking the default branch stores `base: null` so it keeps auto-detecting; the new optional fields default to empty in `stateStore.ts`, no schema version bump, and `stateStore.test.ts` loads an old state file without them), `src/core/store/stateStore.ts` (default, load and prune with the session), `src/renderer/src/stores/slices.ts` (`openDiff` and `backToDiff` read the prefs; `setDiffBase` and `setDiffMode` write them), tests in `src/core/store/stateStore.test.ts` and a new pure helper test in `src/renderer/src/diffView.test.ts`.
**Verification.** `npx vitest run src/core/store src/renderer` passes, including: prefs for a deleted session are dropped on load, and opening a diff for a session without prefs yields the default. Observable: pick Uncommitted only, close and reopen the diff, it is still Uncommitted only; open another session's diff, it is Branch.

### Slice 4. Short smart list with search

**Outcome.** The "compare against" control shows the default branch, then recently picked branches, with a search box that finds any local or remote branch; the long list is gone.
**Files.** `src/core/diff/git.ts` (reuse `listBases` for local and remote names; search results drop `*/HEAD` entries and the current branch), `src/core/core.ts` (`diffRefs` returns local and remote names, current branch and default), `src/shared/ipc.ts`, `src/shared/types.ts` (`UiState.recentBases`), `src/core/store/stateStore.ts`, new `src/renderer/src/diffBases.ts` (pure `baseChoices(refs, recents, query)`) with `diffBases.test.ts`, new `src/renderer/src/components/BasePicker.tsx` and `.module.css`, `DiffViewer.tsx`.
**Verification.** `npx vitest run src/renderer/src/diffBases.test.ts src/core/diff/core.test.ts` passes: an empty query yields default then recents (capped at 5, no duplicates, current branch excluded); a query matches local and remote names case-insensitively; a remote-only branch can be selected, and `src/core/diff/core.test.ts` diffs against a remote-only `origin/<branch>` end to end; `src/core/store/stateStore.test.ts` covers the recents write path (cap of 5, no duplicates, keyed per project) and pruning of `recentBases` for removed projects. `npm run typecheck`. Observable: in a repo with many branches the list shows only main and recents until you type.

### Slice 5. Clear empty states and notes

**Outcome.** Each empty case shows its specific message with a quick switch, and the main-branch and no-main notes read as described in the brief.
**Files.** `src/renderer/src/components/DiffViewer.tsx` and `DiffViewer.module.css`, new pure `emptyMessage(compared, mode)` in `src/renderer/src/diffView.ts` (the only place that words the on-main note, so slice 1's temporary label is replaced here), tests in `src/renderer/src/diffView.test.ts`.
**Verification.** `npx vitest run src/renderer/src/diffView.test.ts`: `emptyMessage` returns the three brief messages for the matching combinations ("No commits on this branch yet." keys on `noOwnCommits`) and the view each quick-switch button targets, the on-main note, and the no-main message. `npm test` and `npm run typecheck` pass. Observable: an unchanged branch shows "No changes on this branch compared to main." with a button to switch view.

## Reviewer round log

- Round 1 (1 blocking, 10 non-blocking). Blocking: Last commit on an unchanged branch cannot show "No commits on this branch yet" → fixed by core-computed `noOwnCommits` in `compared`, last-commit empty when set, added to slice 2 and 5 verification. Applied non-blocking: relabelled uncommitted option in slice 1, single source of truth for prefs, detached HEAD and missing default ref as `noDefault`, recents write and prune tests, `*/HEAD` filtering, Untracked toggle hidden in Last commit, `diffLines` and comment reanchor risks.
- Round 2 (0 blocking, 9 non-blocking). Applied: noDefault falls back to uncommitted, `noOwnCommits` false on the default branch, re-picked default stores null, optional-field defaults for new state, reanchor test moved to the comments tests, remote-only end-to-end test, quick-switch target asserted in `emptyMessage` tests.
- CTO check (0 blocking). Noted: an explicit pick overriding the on-main fallback → stated in D2.

## Deviations from the brief the human should know

- The brief says choices are remembered "for that session while it stays open". The plan stores them with the session in the persisted UI state (D3), so they also survive an app restart of the same session. A new session still starts at the defaults.
- The first open after upgrading lands on the Branch view even if the previous viewer meant uncommitted only (D1).

## Risks and what is deliberately not done

- Repos whose real target is not main or master get the wrong default until the human picks a branch (D2). Upstream or stacked-branch detection is not done.
- Remote branch names come from the local copy of remote refs; the app never runs `git fetch`.
- A new worktree project starts with no recents (D4).
- Expanding unchanged lines between hunks reads the working tree only (`diffLines`), so in Last commit, or Branch with uncommitted edits, expanded context can differ from the shown hunks. Not fixed here.
- Review comments drafted in one view can orphan when the human switches view; the existing re-anchoring handles it and slice 2 tests it. Comment behaviour itself does not change.
- The short list leaves out the current branch, which the brief does not say; it avoids comparing a branch with itself.
- Not done, per the brief's non-goals: commit picker or ranges, PR integration, "viewed" state, changes to comments, file tree or split/unified display.
- The diff cap (20 000 lines) now applies to larger branch diffs; the existing "Diff too large" notice stays.

## Open questions
