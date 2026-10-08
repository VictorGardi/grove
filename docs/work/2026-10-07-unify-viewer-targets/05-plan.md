---
feature: 2026-10-07-unify-viewer-targets
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-08
based_on:
  - 01-questions.md@1
forced: []
---

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

# Plan

## Slice 1 — One project-relative file target and comment anchor

Decisions (human, 2026-10-08): features outside the project folder or under a
dot-folder become unviewable (option 1); unsent slug drafts are dropped.

- [x] `src/shared/types.ts`: drop `ArtifactTarget`; `DocTarget = FileTarget`; anchor `kind: 'file'` without `slug`; `DiffFile.rendered = {path}`; `StateFile` v6, `CommentsFile` v2
- [x] `src/shared/artifactUrl.ts`: URL is `<projectId>/<path>`; remove `~file`
- [x] `src/main/artifacts.ts`: one `core.filePath` route; `sameDoc` on file targets
- [x] `src/core/core.ts`, `comments/{anchor,format,store}.ts`, `diff/compute.ts`: file anchors, per-file re-anchor, comments v1→v2, no feature lookup in format/diff
- [x] `src/core/store/stateStore.ts`: v5→v6 closes an `artifact` viewer
- [x] Renderer: `artifactComments.ts`, `reviewView.ts`, `ReviewTray.tsx`, `slices.ts`, `App.tsx`, `ArtifactViewer.tsx`, `viewerFiles.ts` (`featureOfFile`, `featureDir`)
- [x] Update tests alongside; add migration, URL, `featureOfFile` and commentable-`CONTEXT.md` tests
- [x] ADR 0032, ADR 0022 status, `CONTEXT.md` terms
- [x] Run `npm test` and `npm run typecheck`
