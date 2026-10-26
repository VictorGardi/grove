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

## Slice 5

Session: artifacts-canvas-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Comment.sessionId` is a required string and `CommentsFile` is schema 2 (`types.ts`); `addComment`/`draftsOf`/`markSent`/`dropSession` in `src/core/comments/model.ts` key everything on it, and `addComment` allows one draft note per session. `commentAdd` in `core.ts` refuses an unknown session; `reviewSend` sends `draftsOf(session)` and marks those sent. The file re-anchor loop (`reanchorFiles`, `reanchorFile` in `anchor.ts`) keys on the anchor's `projectId`/`path` only, so it already covers any owner. `loadComments` reads through `readVersioned` with a migrations map (`migrations[n]` turns n into n+1); core saves with a literal `schemaVersion: 2`. Removing a project drops its sessions' comments through `dropSession`. The renderer cannot import `src/core`, only `@shared`. `ArtifactViewer.tsx` holds the frame bridge (message listener accepted only from its frame, `config`/`highlights` sync, `CommentEditor` panel, add/update/delete) keyed on `target.fromDiff ?? focusedSessionId`; `ReviewMenu({ sessionId })` in `ReviewTray.tsx` is the tray, also used by `DiffViewer`. `ArtifactPage` shows `card.path`, which is the html companion when the markdown has one (slice 1 card rule), and html is not commentable (`isCommentable`: `.md` only). A `Session` has `projectId` and `feature` (slug); checkouts of one repo share `worktreeOf ?? id`.

Implementer 1 (shared types and core):
- [x] `src/shared/types.ts`: `FeatureKey { projectId; slug }`; `Comment.sessionId: string | null` and `Comment.feature?: FeatureKey` (set exactly when `sessionId` is null); `CommentsFile.schemaVersion: 3`
- [x] `src/shared/comments.ts` (+ `comments.test.ts`): `sameFeature`, `featureDrafts(cs, feature)`, `linkedDrafts(cs, session, projects)` (the session's own drafts, then drafts owned by the feature with the session's slug in the same repo; none for an unlinked session)
- [x] `src/core/comments/model.ts` (+ test): `addComment` takes `sessionId: string | null` and `feature?`; null owner without a `file` anchor or without a feature is `bad-owner`; `draftsOf` stays session-owned only (what Send sends until slice 6 re-owns); `markSent` prunes only real sessions; `dropFeatureProject(cs, projectId)`
- [x] `src/core/comments/store.ts` (+ test): schema 3, `2 → 3` no-op migration; v1 chains through; `core.ts` saves schema 3
- [x] `src/shared/ipc.ts` `comment:add` takes `sessionId: string | null` and `feature?`; `core.ts` `commentAdd`: null owner needs a listed feature (`not-found`) and a file anchor (`bad-owner`); project removal drops feature-owned drafts of that project
- [x] core tests (`src/core/comments/core.test.ts`, `reanchor.test.ts`): add, update, delete of a feature-owned draft with no session; diff and note anchors rejected with a null owner; persists across restart; schema 2 file loads unchanged; a feature-owned draft re-anchors after an mtime change and orphans when its text is gone; `reviewSend` of a session never sends feature-owned drafts

Implementer 2 (renderer):
- [x] `src/renderer/src/artifactComments.ts` (+ test): `CommentOwner` (session or feature); `draftsForFile(cs, owner | null, target)`; `ownerArgs(owner)` for `comment:add`
- [x] `src/renderer/src/components/ArtifactComments.tsx`: the frame bridge extracted from `ArtifactViewer` as `useArtifactComments({ frame, target, owner, commentable })` plus its editor panel; Send-from-editor only for a session owner
- [x] `ArtifactViewer.tsx` uses it with the session owner, behaviour unchanged
- [x] `artifactsBoard.ts` (+ test): a folded card carries `source: { path; mtimeMs } | null`, its markdown
- [x] `ArtifactPage.tsx` + css: feature owner (the cluster's feature), the bridge on its frame, a "Markdown" toggle when the card has a source so it can be commented, and a feature tray in the header; `ProjectPage.tsx` passes the feature
- [x] `ReviewTray.tsx`: `FeatureReviewMenu({ feature, onJump })` (feature-owned drafts, edit and delete, Send disabled with a note that they are kept until sent); `ReviewMenu` lists `linkedDrafts` with feature-owned ones marked, Send counting the session's own drafts only
- [x] render tests: full page has the tray and the toggle; existing viewer tests unchanged

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking. Non-blocking applied:
- `commentAdd` refuses a feature-owned file anchor in another project than the feature (`bad-owner`, tested), with no non-null assertions;
- a session's tray explains that feature-owned drafts it lists are not sent by its Send;
- the "on the feature" tag has a neutral `.kept` style instead of the orphan warning style;
- a comment on the `drafts` memo's deps in `ArtifactComments.tsx`.

Pass, 0 blocking, 0 fix rounds. Non-blocking left:
- (a) Jumping to a feature-owned draft from a session's tray opens the side viewer with a session owner, so that draft is not highlighted there.
- (b) The full-page tray matches the feature's exact `projectId`, while `linkedDrafts` matches across the repo's checkouts. Drafts written on the main checkout's board do not show on a worktree page's board for the same slug. This follows D3 as written. Slice 6's re-own and Send should collect the repo-wide set the session tray shows.
- (c) Feature-owned drafts are cleaned up only when their project is removed. A deleted or renamed feature folder leaves them in `comments.json`. They still show in a linked session's tray while the slug matches.
- (d) A session's `Comments (n)` counts feature-owned drafts, but its Send sends only the session's own. A hint explains this until slice 6.

### Deviations

- The merge rule (`linkedDrafts`, `featureDrafts`, `sameFeature`) lives in `src/shared/comments.ts`, not `model.ts`, because the renderer cannot import `src/core`. `draftsOf` stays session-owned only, so `reviewSend` never sends a feature-owned draft before slice 6 re-owns it.
- A folded card carries `source` (its markdown), and the full page has a "Markdown" toggle. Without it, a markdown file with an html companion would open only as html, which cannot be commented.
- `ArtifactPage` also takes the cluster's `cards`, so a jump from the feature tray can step to the commented card. `commentCard` in `artifactsBoard.ts` resolves it.
- The full page always uses the feature as the owner, even with a session focused.
- Removing a project drops the feature-owned drafts of that project (`dropFeatureProject`).
- `commentAdd` with a null owner needs a listed feature (`not-found`) and an anchor in the feature's project (`bad-owner`).
- While the full page's Comments popover is open, the arrow keys do not step (the existing dialog rule).

### Verification

- `npm test`: 101 files, 1226 tests pass, existing expectations unchanged except the comments store's schema number (2 → 3).
- New tests:
  - `src/shared/comments.test.ts`: the merge rule (own drafts only; same feature merged; same slug in another repo, another feature, and sent drafts excluded; a worktree checkout of the same repo included; no merge for an unlinked session).
  - `model.test.ts`: `bad-owner` for note, diff or a missing feature; `feature` stored only when feature-owned; never in `draftsOf`; `dropFeatureProject`; `dropSession` and `markSent` leave feature-owned drafts alone.
  - `store.test.ts`: a schema 2 file loads unchanged at schema 3; v1 chains through; a feature-owned draft round-trips.
  - `core.test.ts`:
    - add, update and delete with no session, kept across a restart;
    - `bad-owner` for a null owner with a note, a diff or a file in another project;
    - `not-found` for an unknown feature;
    - `reviewSend` of a session linked to the feature never sends a feature-owned draft;
    - removing the session keeps the draft, and removing the project drops it.
  - `reanchor.test.ts`: a feature-owned draft follows an mtime change and orphans when its quote is gone.
  - `artifactComments.test.ts`: a session owner never sees feature drafts; a feature owner sees only its own on the file; `ownerArgs`.
  - `artifactsBoard.test.ts`: `source` on folded cards; `commentCard`.
  - `projectPageRender.test.ts`: the full page shows the Comments tray; the Markdown toggle appears only for a card with a source.
- Existing side-viewer and diff comment tests pass unchanged.
- `npm run typecheck` passes for node and web.
- Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human:
- open an artifact full page with no session running, select text in a markdown artifact (use the Markdown toggle on an html-backed card), and save a comment;
- step away and back, press Back and reopen: the highlight and the tray entry are still there;
- restart the app: the comment is still there;
- a session linked to that feature lists the draft in its tray, tagged "on the feature", with Send counting only its own drafts;
- the Feature page Files list, the right-hand viewer and diff comments behave as before.

## Slice 6

Session: artifacts-canvas-slice-6-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `reviewSend` (`src/core/core.ts`) sends `draftsOf(session)` (session-owned only) through `sendToSession`, which resumes a gone agent session, guards with a `sending` set (`busy`) and marks sent with `markSent` after the paste. `sessionCreate` takes `projectId`, `kind`, `prompt` (the launch prompt, ADR 0029) and `feature` (refused with `no-feature` unless that checkout lists the slug). `linkedDrafts` in `src/shared/comments.ts` already collects a session's own drafts plus the drafts kept on its feature in any checkout of its repo. The full page's `FeatureReviewMenu` (`ReviewTray.tsx`) lists `featureDrafts` for the exact `projectId`, and Send is disabled. The session tray `ReviewMenu` shows the linked drafts with a hint that Send sends only its own. `usualKind` (`usualKind.ts`) already picks the kind of the repo's most recent agent session, and `LAUNCH_KINDS` (`launchKinds.ts`) lists the kinds with labels. `repoProjectIds` (`repoGroups.ts`) gives a repo's checkouts.

Implementer 1 (shared, core, ipc):
- [x] `src/shared/comments.ts` (+ test): `repoFeatureDrafts(cs, feature, projects)`, the drafts kept on this slug in any checkout of the feature's repo; `linkedDrafts` uses it
- [x] `src/core/comments/model.ts` (+ test): `reown(cs, ids, sessionId)` sets the owner to the session and drops `feature`, for drafts only
- [x] `src/core/core.ts` `reviewSend`: sends `linkedDrafts(session)`, the session's own plus its feature's; after a successful paste, re-owns the feature-owned ones to the session and marks all sent; a failed send (`busy`, `not-ready`, a throw) changes nothing, so they stay feature-owned
- [x] `src/core/core.ts` `reviewStartAndSend({ feature, kind, cols, rows })`: refuses `terminal` (`bad-kind`), an unlisted feature (`not-found`), no drafts (`empty`), and a second call for the same feature while one runs (`busy`). Formats `repoFeatureDrafts` as one message and calls `sessionCreate({ projectId: feature.projectId, kind, prompt, feature: slug, cols, rows })`. Only after create succeeds, re-owns those drafts to the new session and marks them sent. A failed create (error or throw) leaves them feature-owned. Returns `{ sessionId, sent }`.
- [x] `src/shared/ipc.ts` `'review:start-and-send': [{ feature: FeatureKey; kind: SessionKind; cols: number; rows: number }, { sessionId: string; sent: number }]`; wire it in `src/main/ipc.ts` like `review:send`
- [x] core tests (`src/core/comments/core.test.ts`): re-own then send delivers the formatted text and marks drafts sent, owned by the session; `busy` and a failed paste leave drafts feature-owned; start-and-send creates a session linked to the feature in its project with the comments as its prompt, and marks drafts sent only then; a failed create leaves them feature-owned; terminal refused

Implementer 2 (renderer):
- [x] `src/renderer/src/sendTarget.ts` (+ `sendTarget.test.ts`): `resolveTarget(feature, sessions, projects)` returns `{ kind: 'one' | 'many' | 'none'; default: Session | null; candidates: Session[] }`. Candidates are sessions with `feature === slug` in a checkout of the feature's repo, never terminals, running, or gone with an `agentSessionId`, and never a failed start. They are ordered most recently active first (`lastFocusedAt`, else `startedAt`). `defaultKind(sessions, projects, projectId)` uses `usualKind`. Tests: one, many (most recent default, resumable gone included, terminal and unresumable gone excluded), none, other feature or repo excluded, default kind.
- [x] `src/renderer/src/components/SendTargetChip.tsx` + css: "Sending to: <label>"; for several candidates it opens a menu to switch; for none it reads "Sending to: new session" with an agent-kind menu (`LAUNCH_KINDS` without terminal)
- [x] `ReviewTray.tsx` `FeatureReviewMenu`: lists `repoFeatureDrafts`, shows the chip. Send goes to the picked or default session through `review:send`. With no session, "Start a session and send" goes through `review:start-and-send` with the picked kind (cols 120, rows 40). Errors are shown as in `ReviewMenu`, with "Resuming…" for a gone target.
- [x] `ReviewTray.tsx` `ReviewMenu`: Send counts the listed drafts (own plus feature's); drop the "Send sends this session's own" hint
- [x] render test: the full-page tray shows the chip and the right button for one, many and none

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking, 7 non-blocking. Applied:
- `not-found` from `review:send` now reads as a missing session; the feature text is shown only for start-and-send.
- No double send of one feature's drafts. `reviewSend` also holds the `feature:<projectId>:<slug>` busy key of every feature among the drafts it sends, and start-and-send holds them too; tested for two sessions and for a second start-and-send.
- A session still starting is no longer a send target (tested).
- The button label is fixed at click time, so it stays "Starting…" during start-and-send.
- The switch menu marks the current choice.

Pass, 0 blocking, 0 fix rounds. Non-blocking left:
- (a) The full page's Send goes through `review:send`, so it also sends the picked session's own drafts (its diff comments and general note), which the full-page tray does not list. This follows D3 ("through the existing `reviewSend`").
- (b) The full-page tray now lists drafts from every checkout of the repo (slice 5 note (b)). The page's highlights and the jump to a card still match the exact `projectId`, so clicking a draft written in another checkout does nothing. Edit and Delete still work.
- (c) `ReviewMenu` still lists the viewed session's linked drafts but sends to the focused session (behaviour from before this feature).
- (d) Test gaps: no `not-ready` case for a feature-draft send; no test that a draft added during a send stays feature-owned; no start-and-send test that collects a worktree's drafts; no render test of the "Resuming…" label.
- (e) `defaultKind` is a thin alias of `usualKind`.

### Deviations

- The order is send, then re-own, not re-own, then send. After a successful paste, `reviewSend` re-owns and marks sent in one write, so a failed send never touches the drafts. The plan's outcome (feature-owned on failure) is kept.
- `reviewSend` now sends a session's own drafts plus its feature's (`linkedDrafts`) from every tray. The session tray's "Send sends this session's own" hint is removed.
- The full-page tray lists `repoFeatureDrafts` (the slug in any checkout of the repo), so what is sent is what is listed.
- New core command `reviewStartAndSend` and channel `review:start-and-send`, instead of the renderer calling `session:create` and then re-owning. This keeps "mark sent only after create succeeds" atomic in core. It refuses `bad-kind` (terminal), `not-found`, `busy` and `empty`.
- Send targets also exclude sessions whose start failed or is still starting.
- `FeatureReviewPanel` takes `sessions` and `projects` as props so it can be render-tested; the render test is a new file, `featureReviewRender.test.ts`.
- The chip menus reuse `ui/ContextMenu`. Starting a session does not move focus away from the full page.

### Verification

- `npm test`: 103 files, 1247 tests pass.
- `npm run typecheck`: passes for node and web.
- New tests:
  - `sendTarget.test.ts`: one; many (most recent by `lastFocusedAt`, else `startedAt`; resumable gone sessions included; terminals and unresumable gone excluded); starting and failed starts excluded; none; another slug or repo excluded; the default agent kind.
  - `core.test.ts`:
    - re-own then send delivers the formatted text and leaves the drafts sent and owned by the session;
    - a failed paste and `busy` leave the drafts feature-owned;
    - start-and-send creates a session in the feature's project, linked to it, with the comments as the launch prompt, and marks the drafts sent only after create;
    - a failed create (preflight or backend throw) leaves them feature-owned;
    - `bad-kind`, `not-found`, `empty`, and `busy` for overlapping sends.
  - `comments.test.ts`: `repoFeatureDrafts`.
  - `model.test.ts`: `reown`.
  - `featureReviewRender.test.ts`: the chip and button for one session, several and none, and Send disabled with no drafts.
- Models requested: implementer: inherit, reviewer: inherit.

### Left for the human

`npm run dev`, to be run by the human:
- with one linked session, the full-page tray shows "Sending to: <session>" and Send delivers there;
- with several, the chip switches the target;
- with none, "Start a session and send" starts a session (agent kind from the chip menu) whose first message is the comments, and the drafts move to its Sent list;
- a session's own tray Send now also sends its feature's drafts;
- the Feature page and right-hand viewer behave as before.

## Final summary

- Slice 1: `2026-10-26-artifacts-canvas: slice 1 — Artifacts view with full page and Back`. A third project view, Artifacts, shows clusters of title cards per feature. A card opens full page, with Back and a breadcrumb; the open card is kept in `UiState.artifacts` and reset on restart. Review: pass, 0 fix rounds. Deviations: `ArtifactPage` has its own iframe until slice 5; extra helpers `pageClusters` and `openCard`.
- Slice 2: `2026-10-26-artifacts-canvas: slice 2 — Pan and zoom the board`. Hand-written pan and zoom (`canvasView.ts`) through CSS variables, with − / % / + / Fit, and a debounced view write flushed before open and on unmount. Review: pass, 0 fix rounds. Deviations: a `setUi` helper; the board is keyed per project.
- Slice 3: `2026-10-26-artifacts-canvas: slice 3 — Live preview cards`. Cards show live sandboxed previews (html, markdown, images), gated by visibility and zoom, with at most 24 live at once. Review: pass, 2 fix rounds. Deviations: navigation guard and CSP changes so previews load; `viewer:reload` narrowed.
- Slice 4: `2026-10-26-artifacts-canvas: slice 4 — Feature filter and step-through`. A feature filter, kept with the view, and Previous/Next plus arrow keys on the full page in board order. Review: pass, 0 fix rounds. Deviations: a stale filter shows all; a filter change resets the pan.
- Slice 5: `2026-10-26-artifacts-canvas: slice 5 — Comment on artifacts without a session`. Markdown comments on the full page with no session, kept on the feature (`comments.json` schema 3, no-op migration). The frame bridge is extracted from `ArtifactViewer`, and a Markdown toggle covers html-backed cards. Review: pass, 0 fix rounds. Deviations: merge rule in `src/shared/comments.ts`; project removal drops its feature drafts.
- Slice 6: `2026-10-26-artifacts-canvas: slice 6 — Send target chip and start-and-send`. A "Sending to" chip resolved per D4, Send re-owning a feature's drafts on success, and "Start a session and send" through a new core command. Review: pass, 0 fix rounds. Deviations: send then re-own; a new `review:start-and-send` command; busy keys per feature.

### Left for the human

Run `npm run dev` and work through each slice's `### Left for the human` list. In short:
- Artifacts view, full page, Back and breadcrumb;
- pan, zoom and Fit kept across Back and restart, and whether a two-finger scroll should pan;
- live previews refresh on change, with at most 24 iframes;
- filter and step-through;
- commenting with no session, kept across restart;
- the send chip in its three cases, and start-and-send;
- the Feature page and right-hand viewer unchanged.

Known gaps:
- the full page's Send also sends the target session's own drafts;
- a draft from another checkout cannot be jumped to or highlighted on the full page;
- links clicked in the full page open in the side viewer.

### PR description

Artifacts canvas: a project whiteboard of live artifact previews, with comments sent to the right session

Adds an **Artifacts** view on a project, beside Board and Sessions.
- Every feature's artifacts are live preview cards, in labelled clusters in stage order.
- You can pan and zoom the board, filter it to one feature, open a card full page with Back and Previous/Next, and comment on markdown with no session running.
- The comment tray shows "Sending to: <session>": the linked session, a switchable chip when there are several, or "Start a session and send" when there is none.

Per slice:
1. The Artifacts view and full page with Back. The open card is kept in `UiState.artifacts` and never reopened on restart.
2. Pan and zoom (`canvasView.ts`, CSS variables only). The view is debounced and kept across Back and restart.
3. Live previews in opaque sandboxed iframes over `grove-artifact://` (ADR 0007 unchanged), gated by visibility and zoom, at most 24 at once.
4. A feature filter and step-through in board order.
5. Comments kept on a feature when no session owns them (`comments.json` schema 3, a no-op migration), and the frame bridge extracted from `ArtifactViewer`.
6. Send target resolution (`sendTarget.ts`). Send re-owns the feature's drafts only after a successful paste. `review:start-and-send` creates a session linked to the feature, with the comments as its launch prompt, and marks them sent only after create succeeds.

Verified with `npm test` (1247 tests), `npm run typecheck`, and per-slice unit and render tests. The Feature page Files list, right-hand viewer and diff comments are unchanged.

Left for the human: the `npm run dev` checks listed in `04-run.md`. The known gaps: the full page's Send includes the target session's own drafts; a draft from another checkout cannot be jumped to on the full page; links in the full page open in the side viewer. `comments.json` schema 3 cannot be read by older Grove versions.

## Open questions
