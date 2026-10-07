---
feature: 2026-10-07-session-diff
phase: design
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 01-questions.md@1
  - 02-research.md@1
forced: []
---

# Session diff — design

## Desired state

1. With a session focused, a **Diff** button in the content header (and
   **⌥⌘B**, View → "Session Diff") opens that session's diff in the
   right-hand viewer, the panel artifacts use: same resize, expand, close.
2. The diff is `git diff HEAD` of the repo holding the session's working
   directory (the tmux pane's cwd, or the project path once the pane is gone),
   untracked files included as all-added; a header toggle hides them.
3. Plain unified view: one section per file with path, status and +/- counts;
   old/new line numbers on every line. No syntax highlighting or folding.
4. It stays current while the agent works: recomputed while open; the view
   only changes when the diff actually changed.
5. Not a git repo → "Not a git repository"; a git failure shows its error.
6. Every diff line has a stable identity (file, side, number) so
   `2026-10-07-review-comments` can anchor on it without changing this contract.
7. A changed viewable file inside the project (markdown, HTML, images) has
   **Open rendered**: its current content in the iframe viewer, with
   "← Diff" back.
8. Still per working directory, not per session (ADR 0020).

## Non-goals

- Worktrees per session; per-session diffs.
- Comments on diff lines or rendered files (`2026-10-07-review-comments`).
- Syntax highlighting, split view, folding, other bases, rendered md diffs.

## System design

### Diff contract (`src/shared/types.ts`, D3)

```ts
interface SessionDiff {
  sessionId: string
  projectId: string
  state: 'ok' | 'not-git' | 'error'; error: string | null // git's message, or 'timed out'
  root: string | null           // repo top level
  files: DiffFile[]
  truncated: boolean            // total over the line cap
}
interface DiffFile {
  path: string                  // POSIX, relative to root; the new path for renames
  oldPath: string | null        // renames only
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  binary: boolean; additions: number; deletions: number; hunks: DiffHunk[] // binary: no hunks
  truncated: boolean            // over 1 MB: hunks cut
  rendered: { slug: string | null; path: string } | null // D6; slug null: project file
}
interface DiffHunk { header: string; oldStart: number; newStart: number; lines: DiffLine[] }
interface DiffLine { kind: 'context' | 'add' | 'del'; text: string; old: number | null; new: number | null }
```

**Line identity:** `(path, side, number)` — `add` → `new`, `del` → `old`,
`context` → `new`. Review comments store it plus the line's `text`.

### Viewer target (persisted, state file v3, D5)

```ts
type ViewerTarget =
  | { kind: 'artifact'; projectId: string; slug: string; path: string; hash: string | null; fromDiff: string | null }
  | { kind: 'file'; projectId: string; path: string; hash: string | null; fromDiff: string | null }
  | { kind: 'diff'; sessionId: string }
```

`fromDiff`: the session the file was opened from ("← Diff"). `v2ToV3` adds
`kind: 'artifact', fromDiff: null`.

### Diff slice lifecycle (D4)

`Slices.diff: SessionDiff | null`, never persisted. Core computes it while
`ui.viewer.kind === 'diff'`: on open, on each 5 s tick, and on a `wrote` event
or status change of that session. One git run in flight; a request during a
run queues one rerun. `set('diff', …)` only when the raw git output (diff +
untracked list + untracked contents' sizes/mtimes) changed. Viewer leaves the
diff → `null`. Git runs with `GIT_OPTIONAL_LOCKS=0` so it never takes the
index lock from under the agent.

### Git commands (D2)

From the session dir (pane cwd from `backend.cwds()`, else `project.path`):
`git rev-parse --show-toplevel` (fails → `not-git`), then at the root
`git diff HEAD -M --no-color --no-ext-diff` (no `HEAD` yet → diff against the
empty tree) and `git ls-files --others --exclude-standard -z`. Untracked files
are read with `fs` (NUL in the first 8 KB → binary; at most 200 read, the rest
listed without lines). 10 s timeout and `maxBuffer` at the cap per run.

### Project-file route (D6)

`grove-artifact://<projectId>/~file/<path>`: served when
`safeArtifactPath(project.path, path)` passes (relative, no dot-segments so no
`.git/`, symlinks resolved inside the root, a regular file) and `isViewable`.
Same CSP, sandbox, markdown rendering and Mermaid rewrite as artifacts.
`rendered` on a `DiffFile` is set by core: inside a feature folder → artifact;
else inside `project.path` and viewable → file; else `null`.

## Program design

### Call paths

```
Open:     Diff button / ⌥⌘B → openDiff(id) → ui:set {viewer:{kind:'diff'}}
          → core.uiSet → diffWatch.target(id, dir) → computeDiff → set('diff')
          → state:diff → useSlices.diff → <DiffViewer>
Refresh:  poll tick / wrote / status change → diffWatch.poke() → compute → set if changed
Rendered: DiffViewer "Open rendered" → ui:set {viewer:{kind:'artifact'|'file', fromDiff}}
          → <ArtifactViewer> iframe → protocol (artifact or ~file route)
Back:     "← Diff" → ui:set {viewer:{kind:'diff', sessionId: fromDiff}}
```

### File tree

```
src/shared/types.ts                     MODIFIED  ViewerTarget union, SessionDiff…, Slices.diff, StateFile v3
src/shared/artifactUrl.ts               MODIFIED  ~file route in artifactUrl / parseArtifactUrl
src/shared/ipc.ts                       MODIFIED  'state:diff' push; MenuAction 'sessionDiff'
src/core/diff/parse.ts (+ .test)        NEW       parseUnifiedDiff, untrackedFile
src/core/diff/compute.ts (+ .test)      NEW       computeDiff (git runs, caps, rendered targets)
src/core/diff/watch.ts (+ .test)        NEW       createDiffWatch: single-flight, dedupe
src/core/env.ts                         MODIFIED  findTmux → findBin(name) (tmux + git)
src/core/core.ts                        MODIFIED  diff slice, uiSet hook, tick/wrote pokes, filePath()
src/core/store/stateStore.ts            MODIFIED  v2ToV3, schemaVersion 3
src/main/artifacts.ts                   MODIFIED  ~file route; guardNavigation on artifact|file targets
src/main/menu.ts                        MODIFIED  View → Session Diff (⌥⌘B)
src/renderer/src/stores/slices.ts       MODIFIED  diff store, openDiff, openRendered
src/renderer/src/diffView.ts (+ .test)  NEW       visibleFiles (untracked filter), lineKey
src/renderer/src/components/DiffViewer.tsx (+ .module.css)  NEW
src/renderer/src/components/ArtifactViewer.tsx  MODIFIED  file targets, "← Diff"
src/renderer/src/App.tsx                MODIFIED  viewer by kind, Diff button, menu action
```

### Key signatures

```ts
// core/diff/compute.ts
computeDiff(opts: { dir: string; project: Project; features: Feature[]; git: string; sessionId: string }):
  Promise<{ key: string; diff: SessionDiff }>      // key: raw output fingerprint
// core/diff/watch.ts
createDiffWatch(run: (t: DiffTarget) => Promise<{ key: string; diff: SessionDiff }>,
  onChange: (d: SessionDiff | null) => void): { target(t: DiffTarget | null): void; poke(): void; dispose(): void }
// core/core.ts
filePath(projectId: string, rel: string): string | null // ~file route; null: refused
// renderer/diffView.ts
visibleFiles(d: SessionDiff, showUntracked: boolean): DiffFile[]
lineKey(path: string, l: DiffLine): string            // `${path}:${side}:${n}`
```

Tests: parser/caps in Node; `computeDiff` on temp git repos; watch with a
fake runner and timers; DiffViewer checked manually in `npm run dev`.

## One-way decisions

**D1. The diff renders in React in the app renderer** ([ADR 0021](../../adr/0021-session-diff-in-app-from-git-cli.md)).
Text nodes, never `innerHTML`; viewable files open rendered in the iframe.
- Rejected: diff HTML served in the sandboxed iframe — frame reloads on every
  change, postMessage for any interaction, a sandbox with nothing to contain.

**D2. Git is read by spawning the system `git` CLI** (ADR 0021).
- Rejected: `simple-git` (a dependency over the same binary); `isomorphic-git`
  (no renames, ignores git config, can disagree with the terminal).

**D3. Structured contract, parsed once in core** (ADR 0021).
- Rejected: raw unified text parsed in the renderer (every consumer
  re-parses; identity implicit; untracked needs a second shape).

**D4. A `diff` slice holding only the diff on screen** (ADR 0021).
- Rejected: invoke-and-pull (the pattern ADR 0011 rejected); a per-session
  record for all live sessions (N git runs per tick, duplicates per checkout).

**D5. `ui.viewer` is a tagged union, state file v3.**
- Rejected: a separate `ui.diff` field (exclusive fields plus a "which"
  field); a fake artifact path `~diff/<id>` (invisible to the type checker).

**D6. The viewer serves viewable files anywhere in the project folder**
([ADR 0022](../../adr/0022-viewer-serves-project-files.md), amends ADR 0007).
- Rejected: feature-folder files only (ADRs, `CONTEXT.md` unreadable
  rendered); the diff's repo root (allowlist follows live pane cwd).

## Two-way decisions

Repo directory, base, untracked handling, refresh, caps and locks are as in
System design. Also:

| Decision | Choice |
|---|---|
| Untracked toggle | Renderer filter, default shown, not persisted |
| Target | Pinned to a session id; doesn't follow focus |
| Entry points | Diff button in the session content header; ⌥⌘B toggles for the focused session, no-op otherwise |
| Layout | Unified; both line numbers in the gutter; sticky file header |
| Errors | Message in the viewer body, no banner |
| `~file` route | First path segment `~file`; a feature folder literally named `~file` becomes unreachable (accepted) |
| Dot paths | `safeArtifactPath` refuses dot-segments, so files under `.github/` etc. don't open rendered |
| Gone diff session | A diff target whose session was removed → viewer `null` |

## Risks

- **Shared checkout:** sessions on one checkout see each other's changes
  (ADR 0020); the header shows the repo root so it's visible.
- **Git missing:** without Xcode CLT, `/usr/bin/git` may pop an install dialog.
- **Cost on big repos:** `git diff HEAD` every 5 s while open; bounded by
  single-flight and only while a diff is on screen.
- **Wider allowlist:** agent-written HTML anywhere in the project runs in the
  viewer — same sandbox, CSP and no network as artifacts today.
- **Large render:** 20k lines unvirtualized may be slow (virtualize later).

## Open questions
