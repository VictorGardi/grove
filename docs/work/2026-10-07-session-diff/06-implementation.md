---
feature: 2026-10-07-session-diff
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@1
forced: []
---

# Session diff — implementation

## Slice 1 — Tracer: ⌥⌘B shows the focused session's tracked diff

**Changed:** `ViewerTarget` is now the `artifact | file | diff` union with
`DocTarget` for the iframe viewer; `SessionDiff`/`DiffFile`/`DiffHunk`/`DiffLine`
in `shared/types.ts`; `Slices.diff`; state file v3 (`v2ToV3`). New
`core/diff/{git,parse,compute,watch}.ts`: system git via `execFile`
(`GIT_OPTIONAL_LOCKS=0`, 10 s timeout), unified-diff parser, `git diff HEAD` at
the repo root, single-flight watch deduped by a sha1 of git's output. Core
computes the diff while `ui.viewer.kind === 'diff'` (on `uiSet`, start, and
session drops). `findBin('git')` in main; View → Session Diff (⌥⌘B). Renderer:
`DiffViewer` (text nodes only, sticky file headers, two-number gutter), a Diff
toggle button in the session content header, ⌥⌘B toggles for the focused
session.

**Tests:** `diff/parse.test.ts`, `diff/watch.test.ts`, `diff/compute.test.ts`,
`diff/core.test.ts` (open/close, not persisted, reopens on start, git null),
`stateStore.test.ts` (v2 → v3), `env.test.ts` (`findBin`), `artifactUrl.test.ts`.

**Deviations:**
- `parseUnifiedDiff` takes paths from the `diff --git` header (and
  `rename from/to`) and only flags `binary` from the `Binary files … differ`
  line; parsing paths out of "A and B" is ambiguous when a name contains " and ".
- Hunk bodies are read by their `@@` line counts, so a deleted line reading
  `-- a/x` isn't mistaken for a file header.
- New tokens `--diff-{add,del}-{bg,fg}`, `--diff-hunk-bg`, and a pressed style
  for ghost buttons (`aria-pressed`), used by the Diff button.
- `artifactUrl` throws for a `file` target until slice 6.

**Manual check:** `npm run dev`, focus a session whose project is a git repo,
edit a tracked file: ⌥⌘B (or the Diff button) shows it with line numbers;
⌥⌘B again closes it.

## Slice 2 — Live: the open diff follows the agent

**Changed:** `core.ts` pokes the diff watch after each 5 s liveness tick, on
every `wrote` event (any session: a shared checkout shares its diff) and on
`exec-ended`. The watch's key dedupe means unchanged output pushes nothing.
`DiffViewer`'s scroll container has no changing `key`, so scroll survives
updates (already so in slice 1).

**Tests:** `diff/core.test.ts`: a tick picks up a new edit with exactly one
`diff` push across two unchanged ticks; a fake Claude `wrote` event triggers a
recompute.

**Deviations:** none.

**Manual check:** with a Claude session's diff open, let it edit a file: the
diff updates within ~5 s and the scroll position stays.

## Slice 3 — Untracked files and the toggle

**Changed:** `computeDiff` lists `git ls-files --others --exclude-standard -z`
and reads the first 200 with `fs` (over 1 MB → listed, truncated; a NUL in the
first 8000 bytes → binary), appended after tracked files as `untracked`. The
key adds the names and each file's size and mtime. `untrackedFile()` in
`parse.ts`. New `renderer/diffView.ts` (`visibleFiles`, `lineKey`); `DiffViewer`
gets an "Untracked" checkbox (default on, not persisted), keys lines by
`lineKey`, and shows "Binary file" / "Too large to show".

**Tests:** `compute.test.ts` (untracked text, binary, a gitignored file absent;
key changes when an untracked file changes), `parse.test.ts` (`untrackedFile`),
`diffView.test.ts`.

**Deviations:** an untracked symlink is read with `lstat` and listed as binary
(no lines) rather than followed, so a link can't pull in a file outside the repo.

**Manual check:** create a new file in the session's repo: it shows as
Untracked with all lines added; unticking "Untracked" hides it.
