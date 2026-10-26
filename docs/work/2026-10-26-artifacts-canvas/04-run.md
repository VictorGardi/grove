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

## Slice 2

Session: artifacts-canvas-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ArtifactsBoard.tsx` is a vertically scrolling list of clusters (`.board` with `overflow-y: auto`) with title-card buttons; `ProjectPage.tsx` mounts it only while no artifact is open, so opening a card unmounts the board. `UiState.artifacts[projectId]` is `ArtifactsView { open }`; `artifactsTo` writes the whole `artifacts` record built from the renderer's `get().ui`, and core's `uiSet` merges partials only at the top level, so two writes built from a stale `ui` clobber each other (a debounced view write landing after the open, or the open built before a pending view write). `loadState` resets only `open` on load, so a `view` field survives restart with no store change. `noInlineStyles.test.ts` allows only `--*` keys in `style=`. No pan/zoom code or dependency exists; the only debounce idiom is a `setTimeout` timer ref (`ScratchpadOverlay.tsx`, `TerminalView.tsx`). `setSessionOrder` in `slices.ts` is the existing optimistic pattern (set local `ui`, then `ui:set`).

Implementer 1:
- [x] `src/shared/types.ts`: `CanvasView { x; y; scale }`; `ArtifactsView` gains `view?: CanvasView` (absent: the default view)
- [x] `src/renderer/src/canvasView.ts`: pure `DEFAULT_VIEW`, `SCALE` bounds, `clampScale`, `zoomAt(view, factor, point)` keeping the point under the cursor fixed, `wheelFactor(deltaY, pinch)`, `panBy`, `clampPan(view, viewport, content)` keeping part of the content on screen, `fitView(viewport, content, pad)` (never above 1, centred), `zoomStep(view, dir, viewport)` around the viewport centre; `viewWriter(write, delayMs)` with `schedule(view)`, `flush()` and `cancel()` (debounced, flush writes the pending view once, then nothing)
- [x] `src/renderer/src/canvasView.test.ts`: zoom-around-cursor, scale and pan clamping, fit (larger and smaller content, centring), pan, zoom step, write scheduling with fake timers (debounce, flush on unmount writes once, flush with nothing pending is a no-op, cancel)
- [x] `src/renderer/src/artifactsBoard.ts`: `boardViewTo(ui, projectId, view)` returning the `ui:set` partial that keeps `open`; test in `artifactsBoard.test.ts`
- [x] `src/renderer/src/stores/slices.ts`: `setBoardView(projectId, view)`, optimistic (set local `ui`, then `ui:set`) so a following `openBoardArtifact` builds on the new view; `openBoardArtifact` made optimistic the same way so a late view write keeps the open ref
- [x] `components/ArtifactsBoard.tsx` + `.module.css`: a viewport (`overflow: hidden`) holding a fixed-width plane transformed through `--x`, `--y`, `--scale`; view kept in component state initialised from the saved view, written through `viewWriter` on gesture end and flushed before opening a card and on unmount; drag to pan with a small threshold (a drag never opens a card); wheel and trackpad pinch (`ctrlKey` wheel) zoom around the cursor with `preventDefault` on a non-passive listener; zoom controls (−, percentage that resets to 100 %, +, Fit) in a corner
- [x] `components/ProjectPage.tsx`, `App.tsx`: pass the saved view and `onViewChange` (`setBoardView`) through; `projectPageRender.test.ts`: board still renders its clusters and cards, and the saved view lands in the plane's `--x`/`--y`/`--scale`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking. Non-blocking applied: a press released outside the viewport (over the zoom controls) no longer pans with no button held (`e.buttons === 0` clears it); `user-select: none` on the viewport; a restored view is re-clamped once on mount (local only, written by the next gesture); the 100 % reset moved into `canvasView` as `zoomTo`, with a test.

Pass, 0 blocking, 0 fix rounds. Non-blocking left: (a) a `state:ui` echo of an earlier unrelated write landing between a debounced view write and a card click can drop the view from the open write (needs a click within milliseconds of the 300 ms wheel debounce; flush-then-open is unaffected); core merging `artifacts[projectId]` per field would close it; (b) a wheel zoom during a drag is undone by the next pointer move; (c) every wheel event zooms, including a plain two-finger trackpad scroll, and horizontal scroll is ignored, as the slice text says ("wheel or pinch to zoom"); "wheel pans, pinch zooms" may feel more natural on a Mac; (d) the plane is a fixed 1280 px wide.

### Deviations

- `stores/slices.ts`: a small `setUi(partial)` helper (set local `ui`, then `ui:set`) used by the new `setBoardView` and by `openBoardArtifact`, which is now optimistic so a view write and an open write never replace each other.
- `ProjectPage` keys the board on `project.id`, so switching project pages saves the old page's view and starts the new one from its own.
- The flush on unmount and before open is tested at the `viewWriter` level (`canvasView.test.ts`); the component calling it is not unit-tested (no DOM test environment).

### Verification

`npm test`: 97 files, 1159 tests pass, existing expectations unchanged (existing test helpers only gained the new props). New tests: `canvasView.test.ts` (zoom around cursor, scale and pan clamping, fit, pan, zoom step, `zoomTo`, write scheduling with fake timers: debounce, flush once, no-op flush, cancel), `artifactsBoard.test.ts` (`boardViewTo` and `artifactsTo` keep each other's field), `projectPageRender.test.ts` (saved view lands in `--x`/`--y`/`--scale`, default 100 %), `stateStore.test.ts` (`view` survives load while `open` resets). `npm run typecheck` passes for node and web. Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human:
- on the Artifacts board, drag to pan, wheel and pinch to zoom around the cursor, use −, %, + and Fit;
- open a card and press Back: the view is unchanged;
- pan quickly, then immediately open a card or leave the page and come back: the view is kept;
- restart the app: the view is restored;
- judge whether a two-finger scroll should pan instead of zoom.

## Open questions
