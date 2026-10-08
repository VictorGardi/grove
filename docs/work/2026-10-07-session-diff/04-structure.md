---
feature: 2026-10-07-session-diff
phase: structure
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
forced: []
---

# Session diff — structure

## Slices

### Slice 1 — Tracer: ⌥⌘B shows the focused session's tracked diff

- **Outcome:** ⌥⌘B or the Diff button opens the viewer on the focused
  session's `git diff HEAD` (tracked files), unified, with line numbers.
  Computed on open. State file migrates to v3.
- **Files:** `shared/types.ts`, `shared/ipc.ts`, `shared/artifactUrl.ts`,
  `core/store/stateStore.ts`, `core/env.ts`, `core/diff/{parse,compute,watch}.ts`,
  `core/core.ts`, `main/{index,menu,artifacts}.ts`,
  `renderer/stores/slices.ts`, `renderer/components/DiffViewer.tsx`,
  `renderer/components/ArtifactViewer.tsx`, `renderer/App.tsx`.
- **Signatures:** `parseUnifiedDiff(text): DiffFile[]`, `computeDiff(...)`,
  `createDiffWatch(run, onChange)`, `findBin(name, env, dirs?)`.
- **Verify:** `npm test` (`parse.test.ts`, `watch.test.ts`, `compute.test.ts`,
  `diff/core.test.ts`, stateStore v2→v3), `npm run typecheck`; manual in
  `npm run dev`: edit a file in a session's repo, ⌥⌘B shows it; ⌥⌘B closes.
- **Depends on:** none.

### Slice 2 — Live: the open diff follows the agent

- **Outcome:** while open, the diff refreshes on each 5 s tick and on agent
  `wrote` / `exec-ended` events; unchanged output pushes nothing.
- **Files:** `core/core.ts`, `core/diff/watch.ts`, `core/diff/compute.ts` (key).
- **Verify:** `watch.test.ts` (dedupe by key, rerun coalescing),
  `diff/core.test.ts` (tick picks up a new edit; no push when unchanged);
  manual: a Claude session edits a file, the diff updates within ~5 s, scroll
  kept.
- **Depends on:** 1.

### Slice 3 — Untracked files and the toggle

- **Outcome:** untracked files show as all-added (`untracked`), binaries
  without lines; a header toggle hides untracked files.
- **Files:** `core/diff/{compute,parse}.ts`, `renderer/diffView.ts`,
  `renderer/components/DiffViewer.tsx`.
- **Verify:** `compute.test.ts` (untracked text + binary + gitignored),
  `diffView.test.ts` (`visibleFiles`); manual toggle.
- **Depends on:** 1.

### Slice 4 — Edge states

- **Outcome:** not a repo, git missing / failing / timing out, no commits
  yet, renames, size caps with notices, a removed session's diff target → no
  viewer.
- **Files:** `core/diff/{compute,parse}.ts`, `core/store/stateStore.ts`,
  `core/core.ts`, `renderer/components/DiffViewer.tsx`.
- **Verify:** `compute.test.ts` (non-git dir, empty repo, `git mv`, oversize
  file, line cap, null git), `parse.test.ts` (rename, binary, quoted path),
  `stateStore.test.ts` / `diff/core.test.ts` (removed session); manual: a
  non-git project shows "Not a git repository".
- **Depends on:** 1 (3 for untracked caps).

### Slice 5 — Open rendered: feature-folder files

- **Outcome:** a changed viewable file in a feature folder has Open
  rendered → the artifact viewer, with "← Diff" back.
- **Files:** `core/diff/compute.ts` (`rendered`), `renderer/stores/slices.ts`,
  `renderer/components/{DiffViewer,ArtifactViewer}.tsx`, `renderer/App.tsx`.
- **Verify:** `compute.test.ts` (`rendered` mapping); manual round trip.
- **Depends on:** 1.

### Slice 6 — Open rendered: any project file (D6)

- **Outcome:** a changed viewable file anywhere in the project (ADR, `CONTEXT.md`)
  opens rendered via `grove-artifact://<projectId>/~file/<path>`.
- **Files:** `shared/artifactUrl.ts`, `main/artifacts.ts`, `core/core.ts`
  (`filePath`), `core/diff/compute.ts`.
- **Verify:** `artifactUrl.test.ts` (`~file` round trip),
  `diff/core.test.ts` (`filePath` refuses traversal, `.git/`, escaping
  symlink, non-viewable); manual: open a changed ADR rendered.
- **Depends on:** 5.

## Deferred

- Virtualized diff rendering; per-session changed-files badge; other bases;
  worktrees per session; auto-reload of `file` targets on change.

## Rollout / migration

State file v2 → v3 on first launch (slice 1): a saved viewer gains
`kind: 'artifact', fromDiff: null`. No downgrade path (an older build would
move a v3 file aside as unknown).

## Open questions
