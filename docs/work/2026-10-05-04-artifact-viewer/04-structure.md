---
feature: 2026-10-05-04-artifact-viewer
phase: structure
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - 03-design.md@1
  - parent:04-structure.md@5
forced: []
---

# Structure: artifact viewer

Five vertical slices inside the epic's scope for this child (E-D8 without the
comment script). Each slice ends with `npm test` and `npm run typecheck`
passing, plus its own checks below. "The project" in manual steps is this repo
(`~/git/grove`) registered in the app.

## Slices

### Slice 1. Tracer: an HTML artifact opens in the panel

- **Outcome:** on the feature page, clicking an `.html` row opens it in a
  fixed-width right panel (close button only). The `grove-artifact://` scheme,
  handler, path checks, header CSP and renderer `frame-src` are in place.
  Anything outside the feature folders gets the refusal page.
- **Files:** `src/shared/artifactUrl.ts` (+test), `src/shared/types.ts`
  (`UiState.viewer`, `DEFAULT_UI`), `src/core/artifacts/path.ts` (+test),
  `src/core/core.ts` (`artifactPath`), `src/main/artifacts.ts`
  (`registerArtifactScheme`, `handleArtifacts`), `src/main/index.ts`,
  `src/renderer/index.html`, `src/renderer/src/components/ArtifactViewer.tsx`
  (+css), `src/renderer/src/components/shell/AppShell.tsx` (+css),
  `src/renderer/src/components/FeaturePage.tsx` (+css),
  `src/renderer/src/stores/slices.ts`, `src/renderer/src/App.tsx`.
- **Signatures:** `artifactUrl(t: ViewerTarget): string`,
  `parseArtifactUrl(url: string): ViewerTarget | null`,
  `safeArtifactPath(folder: string, rel: string): string | null`,
  `Core.artifactPath(projectId, slug, rel): string | null`,
  `registerArtifactScheme(): void`, `handleArtifacts(core: Core): void`.
- **Verify:**
  - `npm test`: `path.test.ts` covers `..`, encoded `%2e%2e`, absolute, `\`,
    dot file, dot folder, a symlink pointing outside, a directory, a missing
    file, an unknown slug (via `core.artifactPath` in `setupCore()`);
    `artifactUrl.test.ts` round-trips paths with spaces and `#hash`.
  - Manual, `npm run dev`: open `2026-10-05-02-workflow-discovery-sidebar` →
    click `03-design.html` → the page renders in the panel (diagrams may be
    blank). In the panel's DevTools console, `location.origin` is `"null"`.
  - Manual: same check after `npm run build && npm start`.
  - Manual: set the iframe `src` in DevTools to
    `grove-artifact://<pid>/<slug>/../../../../etc/hosts` → refusal page.
- **Depends on:** none.

### Slice 2. Mermaid offline

- **Outcome:** grove-render pages render their diagrams from the bundled
  Mermaid, themed for light and dark, with no network requests.
- **Files:** `src/core/artifacts/html.ts` (+test), `src/main/artifacts.ts`
  (assets host, `?asset` import), `resources/viewer/mermaid-init.js`,
  `package.json` (`mermaid` 12.1.0 devDependency).
- **Signatures:** `rewriteHtml(html: string): string`.
- **Verify:**
  - `npm test`: `html.test.ts` swaps the `mermaid@11` tag (and `@12.1.0`)
    for the two bundled scripts, and leaves a page without the tag unchanged.
  - Manual: open the epic's `03-design.html` → both diagrams render; the
    DevTools Network tab shows no `jsdelivr` request; switch macOS appearance
    and reopen → the diagram theme follows.
- **Depends on:** 1.

### Slice 3. Markdown and images

- **Outcome:** `.md` files render in the panel (frontmatter table, tables,
  task lists, Mermaid fences, code), images display, and all viewable rows on
  the feature page are clickable.
- **Files:** `src/core/artifacts/markdown.ts` (+test),
  `resources/viewer/markdown.css`, `src/main/artifacts.ts` (md and image
  branches, MIME map), `src/renderer/src/components/FeaturePage.tsx`,
  `package.json` (`markdown-it` 15.0.2 dependency).
- **Signatures:** `renderMarkdown(source: string, name: string): string`.
- **Verify:**
  - `npm test`: `markdown.test.ts`: frontmatter becomes a table and is not
    rendered as text; `- [x]` gives a checked disabled checkbox; a mermaid fence
    gives `<pre class="mermaid">` plus both scripts; `<script>` in the source
    comes out escaped; a file with no frontmatter (`00-ticket.md`) renders.
  - Manual: open `2026-10-05-02-workflow-discovery-sidebar/05-plan.md`
    (checkboxes), this feature's `02-research.md` (diagram renders), and
    `00-ticket.md`.
  - Manual: open the epic's `04-structure.html` → the embedded
    `refs/xirp-reference.png` shows.
- **Depends on:** 2.

### Slice 4. Navigation, switcher, Open review

- **Outcome:** the panel header has the stage-grouped switcher. **Open review**
  on the feature page opens the current stage's review file (or its artifact).
  Links route correctly: another feature's artifact opens in the viewer (the
  switcher follows), `https` opens in the system browser, `../../adr/…` shows
  the refusal page, and popups and other schemes are denied.
- **Files:** `src/main/artifacts.ts` (`guardNavigation`), `src/main/index.ts`,
  `src/renderer/src/viewerFiles.ts` (+test),
  `src/renderer/src/components/ArtifactViewer.tsx`,
  `src/renderer/src/components/FeaturePage.tsx`.
- **Signatures:** `guardNavigation(win: BrowserWindow, core: Core): void`,
  `viewableFiles(f: Feature, stages): { label: string; files: string[] }[]`,
  `reviewTarget(f: Feature): string | null`.
- **Verify:**
  - `npm test`: `viewerFiles.test.ts` covers grouping order, "Other", review
    vs. artifact fallback, and no target when neither exists.
  - Manual, in `2026-10-05-02-workflow-discovery-sidebar/03-design.html`:
    click the epic-page link → the epic's `03-design.html` opens and the switcher
    shows the epic's files; click an ADR link → refusal page; click
    **Open review** on that feature → `03-design.html` or the current stage's
    file.
  - Manual: an `https://` link (add one to a scratch `.md` in a feature folder)
    → opens in the browser, the panel stays put.
  - Manual: if `will-frame-navigate` doesn't fire for the sandboxed frame
    (logged in dev), switch to the `did-frame-navigate` fallback named in the
    design's Risks before ticking this slice.
- **Depends on:** 3.

### Slice 5. Live reload and layout

- **Outcome:** editing the open file reloads the panel in place, keeping
  scroll where possible. The splitter, expand toggle and close button work, and
  the open artifact, width and expanded state survive an app restart.
- **Files:** `src/core/discovery/folder.ts` (`mtimes`),
  `src/core/workflow/derive.ts`, `src/shared/types.ts` (`mtimeMs`,
  `viewerWidth`, `viewerExpanded`), `src/shared/ipc.ts` (`viewer:reload`),
  `src/main/ipc.ts`, `src/renderer/src/stores/slices.ts`,
  `src/renderer/src/components/ArtifactViewer.tsx`,
  `src/renderer/src/components/shell/AppShell.tsx` (+css).
- **Signatures:** `'viewer:reload': [void, void]`;
  `setViewerWidth(px: number)`, `toggleViewerExpanded()`, `closeViewer()`.
- **Verify:**
  - `npm test`: `features.test.ts`: after rewriting a file and firing the fake
    root watcher, the pushed slice's `mtimeMs` for that file has changed;
    `stateStore` test: a saved `ui` without the new keys loads with the defaults.
  - Manual: open a scratch `.md` in a feature folder, scroll down, append a
    line from a terminal → the panel reloads within about a second near the same
    place.
  - Manual: drag the splitter (stops at 320 px on each side), expand → the
    panel fills the content area, then collapse and close; reopen, quit with
    Cmd+Q and relaunch → the same artifact, width and expanded state come back.
- **Depends on:** 4.

## Appetite check

The epic gave this child 2 days and about 4 slices. This is 5 slices; 2 and 3
are small (one pure function plus a handler branch each), so 2 days still
holds. If it slips, cut the splitter drag in slice 5 (fixed width plus the
expand toggle) before anything else.

## Deferred

- Repo docs (ADRs, `CONTEXT.md`) in the viewer: needs an epic revision of E-D8
  and E-D2 (epic `feature.md`, `## Follow-ups`).
- Subfolder files in the switcher and their live reload.
- Scroll keeping beyond Chromium's reload restore (child 6's injected script
  could report scroll).

## Open questions
