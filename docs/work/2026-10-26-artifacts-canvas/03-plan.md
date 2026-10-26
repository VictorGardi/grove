---
feature: 2026-10-26-artifacts-canvas
phase: plan
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: artifacts canvas

## Decisions

### D1. How the board and full page are reached and remember their place

**Context.** `ui.board` is `'features' | 'sessions'` and the project page switches on it (`ProjectPage.tsx`). The board must come back at the same pan, zoom and filter after Back, and after an app restart if we want it durable. This shapes `UiState`, which is persisted whole.

**Options.**
- A. Add `'artifacts'` to `ui.board`, and add an optional per-project `artifacts` entry in `UiState` holding `{ filter, view: {x, y, scale}, open }` where `open` is the artifact shown full page (or null). Pros: one source of truth, survives navigation and restart, additive (no schema migration, like `diffPrefs`). Cons: pan/zoom must not write per wheel event: the view lives in renderer state while panning and is written on gesture end (debounced). On restart the board restores the view and filter but never reopens a full page (`open` is kept only for the session's lifetime and reset on load).
- B. Keep pan, zoom, filter and open artifact in React component state. Pros: no persisted state. Cons: lost when the user navigates to a session and back; "Back returns to the same place" fails across navigation.
- C. Make full page a viewer target (`ui.viewer`) over the board. Pros: reuses the viewer. Cons: the viewer is a side panel tied to focus rules; mixes two concepts.

**Pick:** A

**Outcome impact.** Back, and leaving and returning to the project, land on the same view. Cost: a small additive field in `UiState` and throttled writes of the view.

### D2. How a card shows a live preview

**Context.** The brief wants real rendered previews for html, images and markdown. Grove has no thumbnails; artifacts load only through the `grove-artifact://` protocol into sandboxed iframes (ADR 0007) and the renderer cannot read file bodies.

**Options.**
- A. Each card mounts a scaled-down, non-interactive sandboxed iframe of the same `grove-artifact://` URL (images as `<img>`), mounted only while the card is near the visible area and the zoom is high enough, and showing a plain title card otherwise. Pros: real previews with no new IPC or storage, reload on mtime already exists, security model unchanged. Cons: many iframes are heavy, so visibility gating is required.
- B. Generate snapshot images in main (offscreen capture) and cache them. Pros: cheap to draw. Cons: new main-process capture pipeline, cache invalidation, large new surface.
- C. Text excerpt for markdown via a new IPC, iframe only for html. Pros: light. Cons: two preview paths, new IPC, markdown no longer looks like the real page.

**Pick:** A

**Outcome impact.** Cards look like the real artifact. On a very large project, far-away or tiny cards show a title card until they scroll or zoom into range.

### D3. Where comments live when there is no session

**Context.** A `Comment` is owned by a `sessionId` and has no feature (`types.ts` L150-166); the artifact viewer cannot comment without a focused session. The brief requires commenting with no session running, comments kept until sent, and sending to whichever session the chip resolves to.

**Options.**
- A. Make owner either a session or a feature: a draft file-comment may carry `sessionId: null` plus `projectId` and `feature` slug. On Send the drafts are re-owned to the target session and sent through the existing `reviewSend`. `comments.json` goes to schema 3 with a no-op migration (existing comments pass through, tested). Invariant: a null owner is allowed only for `file` anchors; `diff` and `note` anchors stay session-only. A feature-owned draft is keyed by the feature's own `Feature.projectId` and slug. `draftsOf` and the tray merge a session's drafts only with feature-owned drafts whose feature equals that session's `feature` (tested), so they never show up in or get sent through an unrelated session. In `ArtifactPage` the tray and chip mount in the full-page header, keyed on the open artifact's feature, with no session focus required. Pros: smallest change to the send path; existing tray and re-anchoring keep working. Cons: a comment's owner can change once, from feature to session.
- B. Always attach drafts to the feature (never to a session) and send a feature's drafts to a chosen session. Pros: uniform. Cons: diff comments still need sessions, so two owner models forever, and a bigger rewrite of `reviewSend` and the tray.
- C. Create a placeholder session record for commenting. Pros: no schema change. Cons: invents fake sessions that would show up in lists and the sidebar.

**Pick:** A

**Outcome impact.** Comments can be written with no session running and stay on the artifact until sent. One-way cost: `comments.json` moves to schema 3, which older Grove versions cannot read.

### D4. How the target session is resolved

**Context.** A feature's sessions are the sessions with `s.feature === slug` across the repo's checkouts; a feature can have none, one or several, and nothing picks among them today (research). The brief fixes the behaviour: one means that one, several means most recently active with a switchable chip, none means "Start a session and send".

**Options.**
- A. A pure function `resolveTarget(feature, sessions)` returns `{ kind: 'one' | 'many' | 'none', default, candidates }`. "Most recently active" is the session with the latest `lastFocusedAt`, falling back to `startedAt`. "None" calls the existing `session:create` with `feature` and `prompt` set to the formatted comments (the launch-prompt path, ADR 0029) using the agent kind chosen in the chip menu (default: the kind of the project's most recent session). The new session is created in the project that holds the feature folder (`Feature.projectId`, which may be a worktree checkout) so the agent sees the feature files. Candidates are sessions linked to the feature that can receive a paste: running ones, and gone ones that have an agent session id (`sendToSession` resumes them); terminal sessions and gone sessions without an agent session id are excluded; if every session is excluded the case is "none". After a successful create the drafts are re-owned to the new session and marked sent; if create fails they stay feature-owned. Pros: testable, reuses create and send. Cons: "Start a session and send" needs an agent-kind choice, defaulting to the kind of the project's most recent session.
- B. Resolve in the main process behind a new `comments:send-to-feature` command. Pros: one round trip. Cons: puts UI selection logic in core; the chip needs the candidates in the renderer anyway.

**Pick:** A

**Outcome impact.** The human always sees where Send goes, and can switch it. Sessions that cannot receive pastes (terminals, gone sessions with nothing to resume) are never offered.

### D5. Pan and zoom implementation

**Context.** There is no pan or zoom code or dependency; `noInlineStyles.test.ts` allows only `--*` CSS variables in `style=`, so the transform must be driven by CSS variables.

**Options.**
- A. Hand-written pan and zoom in a pure `canvasView.ts` (wheel and trackpad pinch zoom around the cursor, drag to pan, clamp, fit-to-content), applied through `--x`, `--y`, `--scale` on the canvas element. Pros: no dependency, fully unit-testable like `gridView.ts`. Cons: we own the gesture details.
- B. Add a canvas/zoom library. Pros: gestures solved. Cons: new dependency, and it would still have to fit the no-inline-style rule.

**Pick:** A

**Outcome impact.** Smooth pan and zoom with Grove's own look; no new dependency.

## Slices

### Slice 1. Artifacts view with full page and Back

**Outcome.** On a project, a third "Artifacts" switch shows every feature's artifacts grouped in labelled clusters (title cards in stage order); clicking one opens it full page replacing the board, with a Back button and a breadcrumb (project > Artifacts > feature > artifact) that return to the board.
**Card rules.** A card is a viewable file; an html companion (`role: 'review'`) is not a separate card when a markdown artifact with the same stem exists in the feature, the html is what the card previews and opens (falling back to the markdown); non-viewable files get no card; a feature with no cards gets no cluster. Clusters follow the order of the features board (the stage-ordered, union-by-repo list), and cards inside a cluster follow stage order then name; this single order drives step-through.
**Thin end-to-end:** project page switch -> `ui.board = 'artifacts'` and per-project `ui.artifacts.open` (D1) -> `ArtifactsBoard` grouping from the existing features slice -> full page `ArtifactPage` reusing the `grove-artifact://` iframe. Deliberately missing: pan and zoom, live previews, filter, stepping, comments.
**Files.** `src/shared/types.ts` (UiState `artifacts`, board value), `src/renderer/src/artifactsBoard.ts` (+ test), `ArtifactsBoard.tsx`, `ArtifactPage.tsx` (wraps the existing `ArtifactViewer` frame logic so later slices add comments to it; see slice 5) and CSS modules, `ProjectPage.tsx`, `BoardSwitch`, `slices.ts` actions.
**Verification.** `npm test` and `npm run typecheck` pass, including all existing tests unchanged; `artifactsBoard.test.ts` covers grouping, stage ordering, companion de-duplication, viewable-only filtering and empty features; `npm run dev`: switch to Artifacts, click a card, see it full page, press Back and land on the board; the Feature page Files list and right-hand viewer still open and behave as before.

### Slice 2. Pan and zoom the board

**Outcome.** The board is a whiteboard: drag to pan, wheel or pinch to zoom around the cursor, zoom controls and fit-to-view; the view is remembered per project and restored after Back, navigation and restart.
**Files.** `src/renderer/src/canvasView.ts` (+ test), `ArtifactsBoard.tsx`, CSS module, `types.ts` (`view`), `slices.ts` (throttled `ui:set`).
**Verification.** `canvasView.test.ts` covers zoom-around-cursor, clamping, fit and pan math; `npm test` and `npm run typecheck`; `npm run dev`: pan and zoom, press Back from a full page and the view is unchanged, restart the app and it is restored; a quick pan followed immediately by Back or leaving the page does not lose the view (flush on unmount, tested in `canvasView` write-scheduling).

### Slice 3. Live preview cards

**Outcome.** Each card shows a real preview: the rendered page (html, markdown) scaled down, or the image, with name, stage and modified time; cards update when the file changes.
**Files.** `ArtifactCard.tsx`, `previewGate.ts` (+ test: which cards are in range at a given view and zoom), CSS module, `ArtifactsBoard.tsx`.
**Verification.** `previewGate.test.ts` (including a cap on mounted iframes; distance, minimum zoom and the cap are fixed in that module and tuned by hand in this slice; bar: no more than the capped number of live iframes mounted on a project with 50+ artifacts while panning, observed in `npm run dev`); `npm test`; `npm run dev`: previews show real content, far-off or tiny cards fall back to title cards, editing an artifact file refreshes its card.

### Slice 4. Feature filter and step-through

**Outcome.** A feature filter narrows the board to one cluster and clears back; in full page, previous and next step through artifacts in board order, across clusters, respecting the filter.
**Files.** `artifactsBoard.ts` (order and neighbours, + tests), `ArtifactsBoard.tsx`, `ArtifactPage.tsx`, `types.ts` (`filter`).
**Verification.** Neighbour and order tests in `artifactsBoard.test.ts` (including filter and cluster edges); `npm test`; `npm run dev`: filter to one feature, open a card, step with the buttons and arrow keys (arrow keys are ignored while a text input is focused), Back returns to the filtered view.

### Slice 5. Comment on artifacts without a session

**Outcome.** In full page I can comment on a markdown artifact with no session focused or running; drafts stay on the artifact (visible after step-through, Back and restart) and show in the tray.
**Files.** `src/shared/types.ts` (Comment owner: `sessionId` nullable for `file` anchors only, plus `feature`), `src/core/comments/model.ts` (`draftsOf` merge rule), `store.ts` (schema 3 + no-op migration), `core.ts` (comment add and the re-anchor loop at L344-368 for feature-owned drafts), `src/shared/ipc.ts`, `ArtifactViewer.tsx` (extract the frame bridge, `CommentEditor` and message handling so it takes an owner of session or feature, and a no-session mode; `ArtifactPage.tsx` uses it, the side viewer keeps its session behaviour), `ReviewTray.tsx` (merged drafts; Send stays disabled for feature-owned drafts until slice 6, which is acceptable between slices), tests in `src/core/comments/*.test.ts` and `artifactComments.test.ts`.
**Verification.** Core tests: invariant that diff and note anchors reject a null owner; add, update, delete and re-anchor of feature-owned drafts; schema 2 to 3 migration keeps existing comments; a feature-owned draft re-anchors after the artifact's mtime changes and is orphaned when its text is gone; a feature-owned draft never appears for a session linked to another feature; the side viewer and diff comments are unchanged (existing tests); `npm test` and `npm run typecheck`; `npm run dev`: comment with no session, restart, the comment is still there; the Feature page and right-hand viewer still behave as before. Slice 5 alone is not releasable (Send is disabled for feature-owned drafts); slices 5 and 6 ship together.

### Slice 6. Send target chip and start-and-send

**Outcome.** The tray shows "Sending to: <session>" resolved per D4; Send re-owns the feature's drafts to that session and delivers them; with no session, "Start a session and send" creates one in the feature's project with the comments as the first message, then re-owns and marks the drafts sent.
**Files.** `src/renderer/src/sendTarget.ts` (+ test, including the agent-kind default), `SendTargetChip.tsx` (with the agent-kind menu shown for the none case), `ReviewTray.tsx`, `src/core/core.ts` (re-own then `reviewSend`), `src/shared/ipc.ts`, tests.
**Verification.** `sendTarget.test.ts` covers one, many (most recent default, resumable gone sessions included, terminal and unresumable gone sessions excluded), none, and the default agent kind; core tests: re-own then send delivers the formatted text and marks drafts sent; a failed send (`busy`, `not-ready`) leaves drafts feature-owned; start-and-send marks drafts sent only after create succeeds and a failed create leaves them feature-owned; `npm test` and `npm run typecheck`; `npm run dev`: one session sends directly, several show a switchable chip, none starts a session and sends; the Feature page and right-hand viewer still behave as before.

## Reviewer round log

- Round 1 (4 blocking, 8 non-blocking). Blocking: start-and-send drafts never marked sent → fixed by D4 (re-own and mark sent after create, stay feature-owned on failure) and slice 6 tests; new-session project unspecified → fixed by D4 (feature's own project); null-owner effects on existing code → fixed by D3 invariant and merge rule and slice 5 tests; frame-bridge extraction unplanned → fixed by listing the `ArtifactViewer` extraction in slice 5. Applied non-blocking: write-on-gesture-end, no reopen of full page on restart, iframe cap test, gone-session rule, schema 3 note, input-focus key guard, Send disabled until slice 6, extra risks, regression check.
- Round 2 (0 blocking, 11 non-blocking). Applied: tray mount and feature key, merge restricted to same-feature sessions, candidate rule for resumable sessions, agent-kind menu and test in slice 6, card rules for companions and empty features, cluster order, flush on unmount, iframe cap bar, re-anchor and regression checks, slices 5 and 6 ship together.
- CTO check (0 blocking). Non-blocking: breadcrumb now named in slice 1.

## Deviations from the brief the human should know

None.

## Risks and what is deliberately not done

- Many live iframes on a large board are heavy; D2's visibility and zoom gating is the mitigation and is judged in slice 3 by hand.
- Re-owning a feature's drafts on Send changes ownership once; if a send fails (`busy`, `not-ready`), drafts must stay feature-owned (covered in slice 6 core test).
- html artifacts in many live previews may run scripts (mermaid) at once, and a refreshing card changes mtime, which re-anchors markdown comments; both are covered by the gating cap and the existing re-anchor tests.
- Opening an artifact from a diff still uses `target.fromDiff ?? focusedSessionId` and session-owned comments; slice 5 keeps that path unchanged.
- Not done, per the brief's non-goals: dragging cards, a per-feature whiteboard, changes to the Feature page Files list or right-hand viewer, commenting on html or images, and diff comment behaviour.

## Open questions
