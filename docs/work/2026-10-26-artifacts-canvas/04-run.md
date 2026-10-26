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

## Slice 3

Session: artifacts-canvas-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ArtifactsBoard.tsx` draws title-card `<button>`s inside a fixed 1280 px plane transformed by `--x`, `--y`, `--scale`; cards sit in a `minmax(180px, 1fr)` grid, so their size depends on the column count. The view lives in component state (`viewRef`) during gestures. `ArtifactCard` (in `artifactsBoard.ts`) already carries `path`, `stage` and the opened file's `mtimeMs`; markdown is rendered to html by the `grove-artifact://` protocol in main (`src/main/artifacts.ts`), so one sandboxed iframe serves both html and markdown, and images can be `<img>` of the same URL. `ArtifactPage.tsx` remounts its iframe on `url + mtimeMs`, the existing reload idiom. `projectPageRender.test.ts` renders to a string and asserts the board has no `<iframe>`; offset sizes ignore the transform, so card rects measured with `offsetLeft/offsetTop` against the plane are in plane coordinates. No relative-time helper exists in the renderer.

Implementer 1:
- [x] `src/renderer/src/previewGate.ts`: pure `PREVIEW` constants (`minScale`, `margin` in screen px around the viewport, `maxLive` cap); `Rect { x; y; width; height }` in plane coordinates; `screenRect(rect, view)`; `livePreviews(rects: Map<string, Rect>, view, viewport): Set<string>` returning the keys to mount: none below `minScale`, else those whose screen rect meets the viewport grown by `margin`, nearest the viewport centre first, at most `maxLive`
- [x] `src/renderer/src/previewGate.test.ts`: in range vs far off, margin edge, below minimum zoom mounts none, cap with 60 cards in range keeps `maxLive` nearest the centre, pan moves the set, empty viewport
- [x] `src/renderer/src/artifactsBoard.ts`: `previewKind(path): 'image' | 'page'` and `modifiedAgo(mtimeMs, now)` ("just now", "5m ago", "3h ago", "2d ago", then a short date); tests in `artifactsBoard.test.ts`
- [x] `src/renderer/src/components/ArtifactCard.tsx` + `ArtifactCard.module.css`: fixed-size card (preview box on top, then stage, name, modified time); `live` prop: page kinds mount a non-interactive opaque sandboxed iframe (`sandbox="allow-scripts"`, `tabIndex={-1}`, `aria-hidden`, `pointer-events: none`) of `artifactUrl(...)` at a fixed large size scaled down in CSS, images an `<img>` of the same URL; keyed on `url + mtimeMs` so a changed file refreshes; not live: a title-card face (stage and name large)
- [x] `src/renderer/src/components/ArtifactsBoard.tsx` + `.module.css`: cards become `ArtifactCard` in a fixed-width column grid; card rects measured against the plane (`offsetLeft/Top` of each card, keyed by `path`) in a layout effect on clusters change and on viewport resize (`ResizeObserver`); `livePreviews` recomputed from the current view (pan, zoom, controls) and stored only when the set changes; while not measured no previews mount (keeps `projectPageRender.test.ts` asserting no board `<iframe>`)
- [x] `projectPageRender.test.ts`: the board shows each card's modified time and still mounts no iframe before measurement

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 1 blocking. Image cards would not refresh on a file change, because Chromium reuses a loaded image with the same URL. Fix: `previewSrc` adds `?v=<mtime>` to image sources, and the protocol ignores the query (tested). Non-blocking also applied:
- `memo` cards with stable callbacks, and `now` refreshed each minute;
- on-screen cards ranked ahead of margin cards, with `maxLive` 24;
- the ResizeObserver also watches the plane;
- an `inert` preview wrapper;
- the title face shows only the name;
- `IMAGE_EXTS` shared from `artifactUrl.ts`;
- one card key.

Round 2: 2 blocking.
- The renderer CSP `img-src` refused `grove-artifact:` images. Fix: added `grove-artifact:` to `img-src` in `src/renderer/index.html`.
- `guardNavigation` cancelled every sub-frame artifact load that was not `ui.viewer` and pointed the viewer at it. That broke the previews and hijacked the side viewer, and the slice-1 full page was affected the same way. Fix: a sub-frame `grove-artifact:` navigation whose initiator is the main frame (matched by `frameTreeNodeId`) goes through. Links clicked inside a sandboxed frame keep the old handling. New `src/main/artifacts.test.ts`.

Non-blocking also applied in round 2:
- `useMemo` for clusters in `ProjectPage`;
- `ArtifactCard` render tests;
- an exact modified-time assertion.

Round 3: 0 blocking. Non-blocking applied:
- `viewer:reload` reloads only frames that show the viewer's doc, not every preview;
- main-frame guard tests;
- a `clusterKey` helper;
- cross-referencing comments on the two 240 px card widths.

Pass, 0 blocking in the last round, 2 fix rounds. Non-blocking left:
- (a) The `sameDoc` pass-through in `guardNavigation` is now mostly dead. A link clicked in the full page whose target is the doc open in the side viewer navigates the full-page frame in place. Every other link in the full page opens in the side viewer through `uiSet`, which is new behaviour for the full page. The plan does not say where full-page links should go.
- (b) The iframe sits inside a `<button>`, which the HTML spec does not allow for interactive content. It is made inert (`inert`, `pointer-events: none`).
- (c) Title cards show the name twice: on the face and in the meta row.
- (d) The cap values are untuned by hand: `minScale` 0.4, `margin` 400 px, `maxLive` 24.

### Deviations

- `src/main/artifacts.ts` (`guardNavigation`) and `src/renderer/index.html` (CSP) changed. Neither file is in the slice's file list, but previews could not load without these changes. The security model is unchanged: frames are still opaque and sandboxed, and links clicked inside a frame are handled as before.
- `src/main/ipc.ts`: `viewer:reload` is narrowed to the viewer's doc.
- `src/shared/artifactUrl.ts`: exports `IMAGE_EXTS` and `extOf`.
- `previewKind`, `previewSrc` and `modifiedAgo` live in `artifactsBoard.ts`.
- Constants: `minScale` 0.4, `margin` 400 px, `maxLive` 24.

### Verification

- `npm test`: 100 files, 1183 tests pass, existing expectations unchanged.
- New tests:
  - `previewGate.test.ts`: range, margin edge, minimum zoom, the 60-card cap keeping the cards nearest the centre, on-screen before margin, pan, empty viewport;
  - `artifactsBoard.test.ts`: `previewKind`, `previewSrc`, `modifiedAgo`;
  - `artifactCardRender.test.ts`: live page iframe sandboxed inside `inert`, live image with `?v=`, title face;
  - `projectPageRender.test.ts`: modified time shown, no preview before measurement;
  - `artifactUrl.test.ts`: the query is ignored;
  - `src/main/artifacts.test.ts`: navigation guard.
- `npm run typecheck` passes for node and web.
- Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human:
- previews show real content for html, markdown and images;
- far-off or tiny cards fall back to title cards;
- on a project with 50+ artifacts, no more than 24 live iframes are mounted while panning (check in DevTools);
- editing an artifact file refreshes its card, including an image;
- opening cards and the full page does not move the right-hand viewer;
- the slice-1 full page now loads (it was previously cancelled by the navigation guard);
- the right-hand viewer still follows links and reloads;
- tune `PREVIEW` in `previewGate.ts` by feel;
- decide where links clicked in the full page should go (they currently open in the side viewer).

## Slice 4

Session: artifacts-canvas-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ArtifactsView` is `{ open, view? }` per project page; `artifactsTo` spreads the page's entry but `boardViewTo` rebuilds it as `{ open, view }`, so a third field would be dropped by a view write. `pageClusters` gives the page's clusters in board order (features-board columns, then stage, then name), the order step-through must follow. `ProjectPage` decides the open card through `openCard` (shared with App's header crumbs) and renders `ArtifactPage` (header with Back and the name, one sandboxed iframe) or the `ArtifactsBoard` canvas, which keeps its view in local state and saves it through `viewWriter`. Writes to `ui.artifacts` go through the optimistic `setUi` in `slices.ts`. `loadState` resets only `open`, so a `filter` field survives restart with no store change. Window keydown listeners are the idiom for shortcuts (`DiffViewer`, `Modal`); no shared "is a text input focused" helper exists. The side viewer uses a native `<select>` as its file switcher (`ArtifactViewer.tsx`). Features in a page's clusters are unioned by repo, so a slug names one cluster on a page.

Implementer 1:
- [x] `src/shared/types.ts`: `ArtifactsView.filter?: string | null`, the slug of the one feature the board shows (absent or null: all)
- [x] `src/renderer/src/artifactsBoard.ts`: `boardViewTo` keeps every other field of the page's entry; `filterTo(ui, projectId, slug | null)`; `filterClusters(clusters, filter)` (a filter naming no cluster shows all); `neighbours(clusters, ref)` returning `{ prev, next }` as `ArtifactRef | null` in board order across clusters (null at the ends); `stepKey(key, target, modifiers)` returning `-1 | 1 | null` for ArrowLeft/ArrowRight, null with any modifier or when the target is an input, textarea, select or contenteditable
- [x] `src/renderer/src/artifactsBoard.test.ts`: `filterTo` and `boardViewTo`/`artifactsTo` keep each other's fields; `filterClusters` (match, null, stale slug); `neighbours` inside a cluster, across cluster edges, at the first and last card, with a filter, unknown ref; `stepKey` (arrows, modifiers, input/textarea/select/contenteditable ignored)
- [x] `src/core/store/stateStore.test.ts`: `filter` survives load while `open` resets
- [x] `stores/slices.ts`: `setBoardFilter(projectId, slug | null)` through `setUi`
- [x] `components/ArtifactsBoard.tsx` + css: props `filter` and `onFilterChange`; a feature filter (native `<select>` "All features" + one option per cluster, from the unfiltered clusters) and a clear button when set, in a top-left overlay like the zoom controls; the canvas draws `filterClusters(...)`; a filter change moves the pan back to the plane's top-left at the same zoom and saves it
- [x] `components/ArtifactPage.tsx` + css: Previous and Next buttons in the header (disabled at the ends) with "i of n"; window keydown ArrowLeft/ArrowRight through `stepKey`, skipped while a dialog is open
- [x] `components/ProjectPage.tsx`, `App.tsx`: pass `artifactsFilter`, `onArtifactsFilterChange` (`setBoardFilter`); step-through uses the filtered clusters; `projectPageRender.test.ts`: filtered board shows one cluster, full page shows Previous/Next with the right disabled state

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking. Non-blocking applied:
- a filter change writes the view and the filter in one `setUi` (`filterTo(ui, projectId, filter, view?)`, `setBoardFilter(projectId, slug, view?)`); before, two writes went out and the first echo briefly redrew the old clusters;
- the full page's keydown listener attaches once, reading prev, next and onStep through a ref;
- the handler ignores keys already handled (`defaultPrevented`) and keys typed during IME composition;
- a test-name typo;
- the filter select's px sizes are kept, with comments (the repo has no size tokens; 24 px matches the sm buttons beside it).

Pass, 0 blocking, 0 fix rounds. Non-blocking left:
- (a) No DOM test covers the pan reset on a filter change or the keydown listener's dialog skip and cleanup. The repo has no DOM test environment; `stepKey`'s pure tests cover the key rules.
- (b) If the open artifact is outside the filtered set, the full page shows no position and both step buttons are disabled. Today only the board opens cards, so the open card is always inside the filter.
- (c) Holding an arrow key repeats the step, and each step remounts the iframe.

### Deviations

- `stepKey` takes an event-shaped object (`key`, modifiers, `target`), not separate arguments.
- `neighbours` also returns `index` and `total`, which drive the "i of n" label.
- When the saved filter names no feature (stale), the board draws every cluster, the select shows "All features" and Clear is hidden. The stale slug stays in state.
- The step buttons read "Previous" and "Next" with aria-labels "Previous artifact" and "Next artifact". "i of n" is hidden when the open card is outside the filtered set.
- A filter change moves the pan to the plane's top-left at the same zoom, and that view is saved with the filter.

### Verification

- `npm test`: 100 files, 1198 tests pass, existing expectations unchanged.
- New tests:
  - `artifactsBoard.test.ts`: `filterTo` (with and without a view), with `boardViewTo` and `artifactsTo` keeping each other's fields; `filterClusters` (match, none, stale slug); `neighbours` (inside a cluster, across cluster edges both ways, first and last card, with a filter, unknown ref); `stepKey` (arrows, each modifier, input/textarea/select/contenteditable ignored, other keys).
  - `stateStore.test.ts`: `filter` survives load while `open` resets.
  - `projectPageRender.test.ts`: a filtered board draws one cluster with the select listing all features and Clear shown; no Clear unfiltered; the full page reads "1 of 3" with Previous disabled at the first card, and "2 of 2" with Next disabled at the filtered end.
- `npm run typecheck` passes for node and web.
- Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human:
- filter the board to one feature, then clear it;
- open a card and step with Previous and Next, and with the arrow keys, across feature edges;
- arrow keys do nothing while a text input or the filter select is focused; keys pressed inside the artifact frame do not reach the page, so click the header first;
- press Back: the board is still filtered at the same pan and zoom;
- restart the app: the filter is restored.

## Open questions
