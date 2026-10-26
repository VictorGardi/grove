---
feature: 2026-10-26-artifacts-canvas
phase: run
status: draft
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: artifacts canvas

Profile: inherit
Branch: feature/2026-10-26-artifacts-canvas-inherit
Plan commit: 028b57ac96fd5a47f695acfb5d87d27c92d72df3
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: artifacts-canvas-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `UiState.board` is `'features' | 'sessions'` (`src/shared/types.ts`), switched by `BoardSwitch` (`components/shell/BoardSwitch.tsx`) in the content header and by ⌘B (`navigation.ts` `boardKey`); `ProjectPage.tsx` picks `Board` or `SessionsBoard` and always shows sessions on a worktree's page. `ui:set` merges a partial at the top level in core (`core.ts` `uiSet`), and `loadState` (`core/store/stateStore.ts`) fills absent fields from `DEFAULT_UI`, so an optional `artifacts` field needs no schema bump (like `diffPrefs`). Features arrive per checkout and the features board unions them (`featureUnion.ts`) and orders them with `boardColumns` (`tree.ts`); each `Feature.artifacts` entry has `name`, `stage`, `role` (`'review'` for html companions) and `mtimeMs`. `viewerFiles.ts` has `featureDir` (project-relative folder) and `isViewable` lives in `@shared/artifactUrl` with `artifactUrl` building the `grove-artifact://` URL. `ArtifactViewer.tsx` renders the opaque sandboxed iframe (`sandbox="allow-scripts"`) and reloads on mtime change. Breadcrumbs come from `navigation.ts` `crumbs(content)`, which only knows the project for a project page.

Implementer 1:
- [x] `src/shared/types.ts`: `board: 'features' | 'sessions' | 'artifacts'`; `ArtifactRef { projectId; slug; name }` (the feature's own checkout, the card's name); `ArtifactsView { open: ArtifactRef | null }`; `UiState.artifacts?: Record<string, ArtifactsView>` keyed by the project page's id (absent reads as none)
- [x] `src/core/store/stateStore.ts`: on load, every `ui.artifacts[*].open` becomes null (D1: a restart never reopens a full page); test in the store's test file
- [x] `src/renderer/src/artifactsBoard.ts`: `artifactClusters(stages, features: UnionFeature[], projects)` returning clusters `{ feature, cards }` in features-board order (`boardColumns` flattened), cards `{ name, path, stage, mtimeMs }` in stage order then name; html companions (`role: 'review'`) folded into the markdown with the same stem (card keeps the md name, `path` is the html's); non-viewable files and features without cards dropped; `findCard` to resolve an `ArtifactRef`; `artifactsTo(ui, projectId, open)` returning the `ui:set` partial; `artifactCrumbs` (project > Artifacts > feature > artifact)
- [x] `src/renderer/src/artifactsBoard.test.ts`: grouping, stage ordering, companion de-duplication (and html with no md stays its own card), viewable-only, empty features, cluster order, crumbs
- [x] `components/ArtifactsBoard.tsx` + `.module.css`: labelled clusters of title cards; click opens
- [x] `components/ArtifactPage.tsx` + `.module.css`: header with ← Back and the artifact name, the same opaque sandboxed `grove-artifact://` iframe, remounted when the file's mtime changes
- [x] `components/ProjectPage.tsx`: `artifacts` board shows `ArtifactPage` when the project's `open` resolves to a card, else `ArtifactsBoard`; `components/shell/BoardSwitch.tsx`: third "Artifacts" option
- [x] `stores/slices.ts`: `openBoardArtifact(projectId, ref | null)`; `App.tsx`: wire props and use `artifactCrumbs` for the header while a full page is open
- [x] `navigation.ts` `boardKey`: ⌘B from Artifacts goes to Features (sessions ↔ features unchanged); `projectPageRender.test.ts` covers the Artifacts board and full page

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking. Non-blocking applied: ProjectPage and the header crumbs now share `openCard`/`pageClusters` (one function decides what is open); dropped a redundant check in `artifactsBoard.ts`; card key is the path; test-file spacing.

Pass, 0 blocking, 0 fix rounds. Non-blocking left: (a) an open ref whose file disappears falls back to the board but stays set, so the page reopens if the file returns; (b) the ref holds the union's representative `projectId`, so it goes stale (falls back to the board) if the representing checkout changes, worth matching on repo + slug when slice 4 adds step-through; (c) `ArtifactPage` has its own sandboxed iframe that remounts on mtime change instead of sharing `ArtifactViewer`'s reload-in-place frame logic; slice 5 extracts the shared frame bridge anyway.

### Deviations

- ⌘B: `boardKey` already sends Artifacts to Features, so only its comment changed and a test was added.
- `ArtifactPage` reimplements the small iframe part instead of wrapping `ArtifactViewer`. `ArtifactViewer` is unchanged, as the regression check requires, and slice 5 does the extraction.
- Extra pure helpers `pageClusters` and `openCard` in `artifactsBoard.ts`, used by both App and ProjectPage. `openCard` takes `Pick<UiState, 'board' | 'artifacts'>`.

### Verification

`npm test`: 96 files, 1142 tests pass, existing expectations unchanged. New tests are in `artifactsBoard.test.ts` (grouping, stage order, companion de-duplication both ways, viewable-only, empty features, cluster order against `boardColumns`, findCard, artifactsTo, crumbs, openCard), `projectPageRender.test.ts` (board, full page with sandboxed grove-artifact iframe and Back, stale ref, worktree page), `navigation.test.ts` (⌘B from Artifacts) and `stateStore.test.ts` (open reset on load). `npm run typecheck` passes for node and web. Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human. Steps:
- switch a project to Artifacts and click a card to see it full page;
- press Back and land on the board;
- check the breadcrumb: Artifacts returns to the board;
- check that the Feature page Files list and right-hand viewer still open and behave as before.

## Open questions
