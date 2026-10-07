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

## Slice 4 — Edge states

**Changed:** `computeDiff`: `rev-parse --show-toplevel` failing with "not a git
repository" → `state: 'not-git'` (key `'not-git'`); no `HEAD` yet → diff
against the empty tree; `parseUnifiedDiff(raw, 1 MB)` cuts a file whose patch
section is over the cap (counts kept); `capLines` cuts every file after the
running total reaches 20 000 lines and sets `diff.truncated`. `DiffViewer` shows
"Not a git repository" and a top notice when truncated. Core's `dropSessions`
closes a diff of a removed session and clears a doc's `fromDiff` to it, in one
`ui` update; `loadState` does the same for a saved file.

**Tests:** `compute.test.ts` (non-git dir, empty repo, `git mv`, a 1.1 MB
patch, > 20 000 lines, `git: null`), `parse.test.ts` (pure rename, rename with
edits, binary rename, byte cap), `stateStore.test.ts` (orphan diff viewer and
`fromDiff`), `diff/core.test.ts` (`sessionRemove` of the diff's session and of
a `fromDiff` session).

**Deviations:**
- `loadState` also clears an orphan `fromDiff` (the plan only names diff
  viewers), so "← Diff" never points at a removed session.
- The file that crosses 20 000 lines keeps its lines; only later files are cut.

**Manual check:** add a project that isn't a git repo, start a terminal in it,
⌥⌘B: "Not a git repository".

## Slice 5 — Open rendered: feature-folder files

**Changed:** `computeDiff` sets `rendered = { slug, path }` on a changed,
non-deleted viewable file inside one of the project's feature folders
(compared on real paths). `slices.ts` `openRendered` opens it as an artifact
target with `fromDiff: <session>`. `DiffViewer` has an "Open rendered" button
in such files' headers; `ArtifactViewer` takes `onBack` and shows "← Diff",
which `App.tsx` wires to `openDiff(v.fromDiff)`. The switcher and followed
links keep `fromDiff`.

**Tests:** `compute.test.ts`: a changed `docs/work/x/03-design.md` and a new
`refs/new.html` map to feature `x`; a `.ts` file and a deleted `.md` get `null`;
another project's feature is ignored.

**Deviations:** none.

**Manual check:** in a diff, "Open rendered" on a changed `docs/work/*/…md`
shows it rendered; "← Diff" returns to the diff.

## Slice 6 — Open rendered: any project file (D6)

**Changed:** `artifactUrl`/`parseArtifactUrl` handle `kind: 'file'` as
`grove-artifact://<projectId>/~file/<path>` (`FILE_SEGMENT`). `Core.filePath`
runs `safeArtifactPath(project.path, rel)`. The protocol handler serves a
`file` target through it with the same markdown / HTML / image branches and
CSP; `guardNavigation` compares artifact and file targets by kind (`sameDoc`)
and a followed link inherits `fromDiff`. `computeDiff` gives a changed viewable
file outside every feature folder but inside the project
`{ slug: null, path }` relative to the project; `openRendered` opens it as a
`file` target. `App.tsx` renders `ArtifactViewer` for any doc target (a `file`
has no switcher groups and no auto-reload). ADR 0021 and 0022 stay Proposed.

**Tests:** `artifactUrl.test.ts` (`~file` round trip, nested path, hash, empty
path rejected), `diff/core.test.ts` (`filePath` serves `docs/adr/x.md`, refuses
`../x.md`, `.git/HEAD`, a symlink to `/etc/hosts`, a missing file, a folder, an
absolute path and an unknown project), `artifacts/path.test.ts` (encoded
traversal through `~file` URLs), `compute.test.ts` (a changed `docs/adr/0001.md`
gets `{ slug: null, path: 'docs/adr/0001.md' }`; `.github/…` gets none; paths
are relative to a project that is a repo subfolder).

**Deviations:**
- `computeDiff` gives no `rendered` to paths with a dot segment (`.github/…`),
  since the route would refuse them anyway (design's "Dot paths" row).
- The refusal page now reads "outside the project" instead of "outside the
  feature folders".

## Manual checks (`npm run dev`)

1. ⌥⌘B on a session with edits shows the diff; ⌥⌘B again closes. The Diff
   button in the session header does the same and shows pressed while open.
2. A Claude session edits a file: the diff updates within ~5 s, scroll kept.
3. A new untracked file appears; the "Untracked" toggle hides it.
4. A non-git project's session shows "Not a git repository".
5. "Open rendered" on a changed `docs/work/*/…md` and on a changed ADR;
   "← Diff" returns.
6. Restart the app with a diff open: it reopens; with an artifact open from a
   diff: "← Diff" still works.
