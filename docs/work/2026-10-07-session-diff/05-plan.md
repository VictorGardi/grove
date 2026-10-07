---
feature: 2026-10-07-session-diff
phase: plan
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced:
  - "2026-10-07: human chose to bypass grove's gates — plan all six slices up front for one agent to run end to end; 03-design.md and 04-structure.md are not approved"
---

# Session diff — plan (all slices)

Written up front for one agent to execute end to end (see `forced`). Read
`03-design.md` (contract, decisions) and `04-structure.md` first; this file
is the how. Do not re-decide anything in the design; if something here
conflicts with the code, follow the design's intent, note the deviation in
`06-implementation.md`, and continue.

## Ground rules

- **Before starting:** `git status`. The tree holds unrelated untracked docs
  (other features' folders, older ADRs, `spikes/`). Never touch or revert
  them. Stage only files you change for this feature, plus this feature's
  folder, ADR 0021/0022 and `CONTEXT.md`, with explicit paths
  (`git add <file>…`, never `git add -A`).
- **Per slice:** implement → `npm run typecheck` → `npm test` → commit
  `2026-10-07-session-diff: slice N — <outcome>` → append a section to
  `06-implementation.md` (create it on slice 1 with frontmatter
  `phase: implementation`, `status: draft`, `version: 1`, `based_on:
  [05-plan.md@1]`): what changed, tests added, deviations, the manual check
  for the human. Tick this file's checkboxes as you go. Don't push.
- **Style:** match the surrounding code: terse comments only where
  non-obvious, CSS modules with tokens from `src/renderer/src/styles/tokens.css`
  (`noInlineStyles.test.ts` forbids `style=` in the renderer), no new npm
  dependencies.
- **Tests that spawn git:** real `git` from PATH. Use the helper from step
  1.4. On macOS `os.tmpdir()` is a symlink (`/var` → `/private/var`) and
  `git rev-parse --show-toplevel` returns the real path: always
  `fs.realpathSync` project and feature paths before comparing to a git root.
- **Manual checks** (`npm run dev`) can't be done by you: list them in
  `06-implementation.md` for the human, don't block on them.

## Slice 1 — Tracer: ⌥⌘B shows the focused session's tracked diff

### 1.1 Shared types (`src/shared/types.ts`)

- [x] Replace `ViewerTarget` with:
  ```ts
  export interface ArtifactTarget { kind: 'artifact'; projectId: string; slug: string; path: string; hash: string | null; fromDiff: string | null }
  export interface FileTarget { kind: 'file'; projectId: string; path: string; hash: string | null; fromDiff: string | null }
  export interface DiffTarget { kind: 'diff'; sessionId: string }
  export type DocTarget = ArtifactTarget | FileTarget // what the iframe viewer shows
  export type ViewerTarget = DocTarget | DiffTarget
  ```
  (`FileTarget` is only produced from slice 6 on; define it now.)
- [x] Add `SessionDiff`, `DiffFile`, `DiffHunk`, `DiffLine` exactly as in
  `03-design.md` § Diff contract (`DiffFile.rendered: { slug: string | null; path: string } | null`).
- [x] `Slices` gains `diff: SessionDiff | null`. `StateFile.schemaVersion`
  becomes `3`.

### 1.2 IPC and URL (`src/shared/ipc.ts`, `src/shared/artifactUrl.ts`)

- [x] `PushMap` gains `'state:diff': SessionDiff | null`. `MenuAction` gains
  `{ type: 'sessionDiff' }`. (`registerIpc` already pushes every slice key.)
- [x] `artifactUrl(t: DocTarget)`: for now only `kind: 'artifact'` (slice 6
  adds `file`). `parseArtifactUrl` returns `ArtifactTarget | null` with
  `kind: 'artifact', fromDiff: null`.
- [x] Update `src/shared/artifactUrl.test.ts` expectations for the new fields.

### 1.3 State file v3 (`src/core/store/stateStore.ts`)

- [x] Add `v2ToV3`: if `s.ui?.viewer` is non-null and has no `kind`, replace
  it with `{ kind: 'artifact', ...viewer, fromDiff: null }`.
- [x] `readVersioned<StateFile>(file, 3, { schemaVersion: 3, … }, onBad, { 1: v1ToV2, 2: v2ToV3 })`.
- [x] In `core.ts` `set()`: `saveState(…, { schemaVersion: 3, … })`.
- [x] `stateStore.test.ts`: a v2 file with an old viewer loads as
  `{ kind: 'artifact', …, fromDiff: null }`; existing fixtures updated to v3
  shapes.

### 1.4 Git runner and test repo helper

- [x] `src/core/env.ts`: generalise `findTmux` to
  `findBin(name: string, env, dirs = FIXED_DIRS): string | null`; keep
  `export const findTmux = (env, dirs?) => findBin('tmux', env, dirs)` so
  callers and `env.test.ts` stay; add one `findBin('git', …)` test.
- [x] `src/core/diff/git.ts` (NEW):
  ```ts
  export type GitRun = (args: string[], cwd: string) => Promise<string>
  export class GitError extends Error { constructor(msg: string, readonly notRepo: boolean) }
  export function gitRunner(gitPath: string, env: NodeJS.ProcessEnv): GitRun
  ```
  `execFile(gitPath, ['-c', 'core.quotePath=false', ...args], { cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })`.
  On failure reject `GitError`: message `'timed out'` when `err.killed`,
  `'diff too large'` on `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, else trimmed
  stderr (fallback `err.message`); `notRepo` = stderr matches
  `/not a git repository/i`.
- [x] `src/core/testing/gitRepo.ts` (NEW, test helper):
  `gitRepo(dir?)` → `git init -q -b main`, `git config user.email t@t`,
  `user.name t`, `commit.gpgsign false`; returns `{ dir, write(rel, text), commit(msg='c') , git(...args) }`
  using `execFileSync('git', …, { cwd: dir })`.

### 1.5 Parser (`src/core/diff/parse.ts`, NEW)

- [x] `export function parseUnifiedDiff(text: string): DiffFile[]` — every
  file starts at `diff --git `. Within a file:
  - `new file mode` → `added`; `deleted file mode` → `deleted`;
    `rename from X` / `rename to Y` → `renamed`, `oldPath = X`, `path = Y`;
    default `modified`.
  - `--- a/X` / `+++ b/Y` (or `/dev/null`) set paths; strip the `a/`/`b/`
    prefix; unquote C-quoted paths (`"…"` with `\\ \" \t \n` and `\ooo`
    octal bytes, decoded as UTF-8).
  - `Binary files A and B differ` → `binary: true`, paths from A/B.
  - `@@ -o[,n] +n[,m] @@ …` starts a hunk: `header` = the whole line,
    `oldStart`, `newStart`; then `' '` → context (old++, new++), `'+'` → add
    (new++), `'-'` → del (old++), `'\'` (no newline marker) skipped. `text` is
    the line without its first char.
  - `additions`/`deletions` counted; `truncated: false`; `rendered: null`.
  - Mode-only change (no hunks): `modified`, `hunks: []`.
- [x] `parse.test.ts`: modified file with two hunks (line numbers checked on
  context/add/del), added, deleted, no-newline marker, binary, quoted path
  with a space and a non-ASCII char. (Rename cases come in slice 4.)

### 1.6 Compute (`src/core/diff/compute.ts`, NEW)

- [x] ```ts
  export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  export async function computeDiff(o: { sessionId: string; dir: string; project: Project; features: Feature[]; git: GitRun | null }):
    Promise<{ key: string; diff: SessionDiff }>
  ```
  Slice 1 version: `root = (await git(['rev-parse', '--show-toplevel'], dir)).trim()`;
  `raw = await git(['diff', 'HEAD', '-M', '--no-color', '--no-ext-diff', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/'], root)`;
  `files = parseUnifiedDiff(raw)`; `key = sha1(raw)` (node `crypto`);
  `state: 'ok'`. Any thrown error → `state: 'error'`, `error: e.message`,
  `files: []`, `key = 'error:' + message`. `git === null` → error
  `'git not found'`.
- [x] `compute.test.ts`: temp repo with a committed file, edit it →
  one `modified` file with the right lines; clean repo → `files: []`.

### 1.7 Watch (`src/core/diff/watch.ts`, NEW)

- [x] ```ts
  export function createDiffWatch(
    run: (sessionId: string) => Promise<{ key: string; diff: SessionDiff }>,
    onChange: (d: SessionDiff | null) => void,
  ): { target(id: string | null): void; poke(): void; dispose(): void }
  ```
  State: `current: string | null`, `lastKey: string | null`, `running`,
  `rerun`. `target(id)`: same id → no-op; else `current = id`,
  `lastKey = null`, `onChange(null)`, then `poke()` if `id`. `poke()`: no
  `current` or disposed → return; `running` → `rerun = true`; else loop
  `{ rerun = false; id = current; r = await run(id); if (!disposed && current === id && r.key !== lastKey) { lastKey = r.key; onChange(r.diff) } } while (rerun && current && !disposed)`.
  `run` rejecting must not kill the loop (catch; treat as no change).
- [x] `watch.test.ts` (fake `run` with controllable promises): target emits
  null then the diff; a poke during a run causes exactly one rerun; a target
  switch mid-run drops the stale result; same key twice → one `onChange`;
  `target(null)` emits null.

### 1.8 Core wiring (`src/core/core.ts`)

- [x] `CoreOptions.git?: string | null` (path to git; `undefined` → `'git'`,
  `null` → not found). Build `const git = opts.git === null ? null : gitRunner(opts.git ?? 'git', minimalEnv(process.env))`.
- [x] `slices` initial `diff: null`.
- [x] Keep the last `cwds` map: in `refreshBranches` store it in
  `let lastCwds = new Map<string, string>()`.
- [x] `const diffWatch = createDiffWatch(runDiff, (d) => set('diff', d))`
  with `runDiff(id)`: find session + project (missing → error diff
  `'session not found'`); `dir = s.lastStatus === 'running' ? lastCwds.get(s.tmuxName) ?? project.path : project.path`;
  `computeDiff({ sessionId: id, dir, project, features: slices.features.items, git })`.
- [x] `function syncDiff(): void { const v = slices.ui.viewer; diffWatch.target(v?.kind === 'diff' ? v.sessionId : null) }`
  — call at the end of `uiSet`, at the end of `start()` (after the first
  `refreshBranches`), and in `dropSessions` (step 4.5 adds the clearing).
- [x] `dispose()`: `diffWatch.dispose()`.
- [x] `src/core/diff/core.test.ts` (NEW, uses `setupCore()` from
  `testing/setup.ts` and `gitRepo(s.dir)` — the project dir is the repo):
  create a terminal session, edit a committed file,
  `uiSet({ viewer: { kind: 'diff', sessionId } })`, `await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))`;
  `uiSet({ viewer: null })` → `diff` is `null`; `diff` never appears in the
  saved state file.

### 1.9 Main (`src/main/index.ts`, `menu.ts`, `artifacts.ts`)

- [x] `index.ts`: `const gitPath = findBin('git', process.env)`; pass
  `git: gitPath` to `createCore` (null → the viewer shows "git not found"; no
  banner).
- [x] `menu.ts` View submenu, after Project Board:
  `{ label: 'Session Diff', accelerator: 'CmdOrCtrl+Alt+B', click: () => send({ type: 'sessionDiff' }) }`.
- [x] `artifacts.ts`: protocol handler unchanged except types;
  `guardNavigation` compares only when `cur?.kind === 'artifact'`, and a
  followed link becomes `{ ...t, fromDiff: cur?.kind === 'artifact' ? cur.fromDiff : null }`.

### 1.10 Renderer

- [x] `stores/slices.ts`: `diff: SessionDiff | null` (initial `null`),
  `api.on('state:diff', (diff) => set({ diff }))`; actions
  `openDiff(sessionId)` → `ui:set { viewer: { kind: 'diff', sessionId } }`;
  `openArtifact(t: DocTarget)` unchanged otherwise.
- [x] `components/DiffViewer.tsx` + `DiffViewer.module.css` (NEW). Props:
  `{ diff: SessionDiff | null; sessionId: string; label: string; expanded; onToggleExpanded; onClose }`.
  Header like `ArtifactViewer` (title `Diff · <label>`, root path muted,
  expand + close buttons with the same `Button` props). Body:
  - loading when `diff === null || diff.sessionId !== sessionId`;
  - `state === 'error'` → the message; (`not-git` handled in slice 4);
  - no files → "No changes";
  - per file a section: sticky header (status word, `oldPath → path` for
    renames, `+a −d`), each hunk's `header` row, then a two-number gutter
    (`old`, `new`, blank when null) + sign + text with `white-space: pre`,
    add/del rows tinted via tokens. Keys from `lineKey` (step 3.3 adds the
    helper file; for now inline `${path}:${kind}:${old}:${new}`).
  Text only as React children — never `dangerouslySetInnerHTML`.
- [x] `components/ArtifactViewer.tsx`: `target: DocTarget` (artifact only for
  now; `groups` already empty for unknown features).
- [x] `App.tsx`:
  - viewer slot: `v.kind === 'diff'` → `<DiffViewer …>` (label from the
    session, or `'session'` if missing); else `<ArtifactViewer …>`; existing
    `openArtifact` call sites add `kind: 'artifact', fromDiff: null`.
  - `ContentHeader right` for `shown.kind === 'session'`: a ghost `Button`
    "Diff" (`aria-pressed` when the viewer is that session's diff) toggling
    `openDiff(id)` / `closeViewer()`.
  - `menu:action` `sessionDiff`: if `ui.focusedSessionId` → same toggle;
    else no-op.
- [x] `npm run typecheck && npm test`; commit slice 1.

## Slice 2 — Live: the open diff follows the agent

- [x] `core.ts`: `checkLiveness` → after `refreshBranches()` call
  `diffWatch.poke()` (the 5 s tick).
- [x] `core.ts` `onEvent`: on `wrote` (any session — a shared checkout
  means anyone's write changes the diff) and on `exec-ended`, call
  `diffWatch.poke()`.
- [x] `computeDiff` key already dedupes tracked output; confirm `set('diff')`
  only fires on a new key (covered by watch tests).
- [x] `DiffViewer`: preserve scroll across updates — the scroll container
  must not remount (no `key` on it that changes with the diff).
- [x] `diff/core.test.ts`: with a diff open, edit another line and call
  `core.checkLiveness()` → new content; call it again unchanged → the `slice`
  listener sees no `diff` push (count pushes via `core.on('slice')`); a
  fake `claude.emit({ type: 'wrote', … })` triggers a recompute.
- [x] Commit slice 2.

## Slice 3 — Untracked files and the toggle

- [x] `compute.ts`: after the diff,
  `names = (await git(['ls-files', '--others', '--exclude-standard', '-z'], root)).split('\0').filter(Boolean)`.
  For the first 200: `stat` (real path under root); size > 1 MB →
  `untrackedFile(name, null, true)`; read buffer; NUL byte in the first
  8000 bytes → binary; else `untrackedFile(name, text, false)`. The rest:
  `untrackedFile(name, null, true)`. Append after tracked files. Key =
  sha1 of `raw + '\0' + names.join('\0') + sizes and mtimeMs of the read files`.
- [x] `parse.ts`: `export function untrackedFile(path: string, text: string | null, truncated: boolean, binary = false): DiffFile`
  — `status: 'untracked'`, one hunk `@@ -0,0 +1,N @@` of `add` lines
  numbered 1..N (drop the final empty element after a trailing `\n`),
  `additions: N`.
- [x] `src/renderer/src/diffView.ts` (NEW): `visibleFiles(d, showUntracked)`,
  `lineKey(path, l)` = `` `${path}:${l.kind === 'del' ? 'old' : 'new'}:${l.kind === 'del' ? l.old : l.new}` ``
  (the design's line identity). Use `lineKey` in `DiffViewer`.
- [x] `DiffViewer`: header checkbox/toggle "Untracked" (local `useState(true)`),
  files from `visibleFiles`; binary files show "Binary file"; truncated
  files show "Too large to show".
- [x] Tests: `compute.test.ts` (untracked text, untracked binary, a
  gitignored file absent); `diffView.test.ts` (filter, `lineKey` for each
  kind).
- [x] Commit slice 3.

## Slice 4 — Edge states

- [ ] Not a repo: `rev-parse` `GitError.notRepo` → `state: 'not-git'`,
  `root: null`, key `'not-git'`. `DiffViewer` shows "Not a git repository".
- [ ] No commits yet: `git rev-parse --verify -q HEAD` fails → diff against
  `EMPTY_TREE` instead of `HEAD`.
- [ ] Caps in `compute.ts`: a tracked file whose patch section exceeds 1 MB
  (track section byte length in the parser, `DiffFile` gets cut:
  `hunks: []`, `truncated: true`); walking files in order, once total lines
  pass 20 000, later files get `hunks: []`, `truncated: true` and
  `diff.truncated = true`. `DiffViewer` shows a top notice when
  `diff.truncated`.
- [ ] `parse.test.ts`: pure rename (no hunks), rename with edits, binary
  rename.
- [ ] Removed session: `dropSessions` → if `ui.viewer` is a diff of a dropped
  session set `viewer: null`; if it's a doc with `fromDiff` of a dropped
  session set `fromDiff: null`; then `syncDiff()`. `loadState`: a diff
  viewer whose `sessionId` isn't in `sessions` → `viewer: null`.
- [ ] Tests: `compute.test.ts` (non-git dir, empty repo, `git mv`, a 1.1 MB
  file, > 20k lines, `git: null`), `stateStore.test.ts` (orphan diff
  viewer), `diff/core.test.ts` (`sessionRemove` of the diff's session).
- [ ] Commit slice 4.

## Slice 5 — Open rendered: feature-folder files

- [ ] `compute.ts`: for each file with `status !== 'deleted'` and
  `isViewable(path)` (from `@shared/artifactUrl`): `abs = path.join(root, file.path)`;
  a feature `f` of this project with `abs` inside `realpath(f.path) + sep` →
  `rendered = { slug: f.slug, path: posix rel to the feature folder }`;
  otherwise `null` (slice 6 adds project files).
- [ ] `slices.ts`: `openRendered(projectId, sessionId, r)` → `ui:set` viewer
  `{ kind: 'artifact', projectId, slug: r.slug, path: r.path, hash: null, fromDiff: sessionId }`
  (slice 6 adds the `file` branch).
- [ ] `DiffViewer`: "Open rendered" ghost button in the file header when
  `file.rendered`.
- [ ] `ArtifactViewer`: `onBack?: () => void`; when set, a "← Diff" ghost
  button at the left of the header. `App.tsx` passes it when
  `v.fromDiff` → `openDiff(v.fromDiff)`. Opening another artifact from the
  switcher keeps `fromDiff`.
- [ ] Tests: `compute.test.ts` — a feature folder in the repo
  (`docs/work/x/feature.md`), a changed `docs/work/x/03-design.md` gets
  `{ slug: 'x', path: '03-design.md' }`; a `.ts` file gets `null`. Feed
  `features` built with the same shape `core` uses (`Feature.path` absolute).
- [ ] Commit slice 5.

## Slice 6 — Open rendered: any project file (D6)

- [ ] `artifactUrl.ts`: `export const FILE_SEGMENT = '~file'`;
  `artifactUrl` for `kind: 'file'` → `grove-artifact://<projectId>/~file/<encoded path>`;
  `parseArtifactUrl` returns `FileTarget` when the first segment is `~file`.
  Tests: round trip, nested path, hash.
- [ ] `core.ts`: `filePath(projectId, rel): string | null` on `Core` →
  `safeArtifactPath(project.path, rel)` (it already refuses absolute,
  backslash, dot-segments incl. `.git`, symlink escapes, non-files).
- [ ] `main/artifacts.ts`: for a `file` target,
  `file = isViewable(t.path) ? core.filePath(t.projectId, t.path) : null`;
  then the same `.md` / `.html` / binary branches. `guardNavigation`:
  compare `artifact` by projectId/slug/path/hash and `file` by
  projectId/path/hash; a followed link inherits `fromDiff`.
- [ ] `compute.ts`: when not in a feature folder, `rel = path.relative(realpath(project.path), abs)`;
  inside (no `..`, not absolute) and viewable → `{ slug: null, path: posix rel }`.
- [ ] `slices.ts` `openRendered`: `r.slug === null` →
  `{ kind: 'file', projectId, path: r.path, hash: null, fromDiff: sessionId }`.
- [ ] `ArtifactViewer` / `App.tsx`: a `file` target has `groups = []`,
  `mtimeMs = undefined` (no auto-reload; deferred).
- [ ] Tests: `diff/core.test.ts` — `filePath` returns a path for
  `docs/adr/x.md`, `null` for `../x.md`, `.git/HEAD`, a symlink pointing
  outside, a missing file; `compute.test.ts` — a changed `docs/adr/0001.md`
  gets `{ slug: null, path: 'docs/adr/0001.md' }`.
- [ ] Leave ADR 0021 and 0022 at `Proposed` (only approval flips them). Update `06-implementation.md` with the full manual checklist:
  1. ⌥⌘B on a session with edits shows the diff; ⌥⌘B again closes.
  2. A Claude session edits a file: the diff updates within ~5 s, scroll kept.
  3. A new untracked file appears; the toggle hides it.
  4. A non-git project's session shows "Not a git repository".
  5. Open rendered on a changed `docs/work/*/…md` and on a changed ADR; "← Diff" returns.
  6. Restart the app with a diff open: it reopens; with an artifact open from a diff: "← Diff" still works.
- [ ] Commit slice 6.

## Open questions
