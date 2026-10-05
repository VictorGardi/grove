---
feature: 2026-10-05-04-artifact-viewer
phase: implementation
status: draft
version: 2
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@2
forced: []
---

# Implementation: artifact viewer

## Progress

- [x] Slice 1 — Tracer: an HTML artifact opens in the panel
- [x] Slice 2 — Mermaid offline
- [x] Slice 3 — Markdown and images
- [ ] Slice 4 — Navigation, switcher, Open review
- [ ] Slice 5 — Live reload and layout

## Slice 1 — Tracer: an HTML artifact opens in the panel

Verification: `npm test` 154/154 passed (run outside the Claude Code sandbox:
inside it the real-tmux tests in `src/core/backend/tmux.test.ts` fail with
`posix_spawnp failed`, unrelated); `npm run typecheck` clean; `npm run build`
clean. Manual checks (dev, `npm start`, traversal refusal) passed, confirmed
by the human on 2026-10-05.

Deviations (small, two-way):

- `closeViewer()` added to the store now (structure lists it under slice 5)
  because slice 1's panel has a close button.
- `ViewerTarget` lives in `src/shared/types.ts` (next to `UiState`, which uses
  it) rather than `src/shared/artifactUrl.ts`; `artifactUrl.ts` also exports
  `ARTIFACT_SCHEME` and `ASSETS_HOST` for main.
- `hash` is stored and emitted raw (no percent-encoding), so it round-trips.
- `src/core/store/stateStore.test.ts` round-trip fixture gained a `viewer`
  value (required by the type; also exercises its persistence).
- `VIEWABLE` is not created yet: slice 1 serves and links only `.html`/`.htm`
  (`/\.html?$/i` in `src/main/artifacts.ts` and `FeaturePage.tsx`); slice 3
  introduces the full list.

## Slice 2 — Mermaid offline

Verification: `npm test` 157/157 passed (outside the sandbox, as in slice 1);
`npm run typecheck` clean; `npm run build` clean and emits
`out/main/chunks/mermaid.min-*.js`. Manual check (diagrams render, no
`jsdelivr` request, theme follows appearance) passed, confirmed by the human
on 2026-10-05.

Deviations (small, two-way):

- `npm install` had to run outside the Claude Code sandbox (npm cache not
  writable inside it); npm 11 reported pending install scripts for
  `node-pty`/`esbuild` (`allow-scripts`) but the existing builds were kept and
  all tests, including real tmux/pty ones, pass.
- `rewriteHtml` exports `MERMAID_SCRIPTS` (the two bundled tags) for reuse
  by `renderMarkdown` in slice 3.
- Asset responses also carry the CSP header (harmless; the design says every
  response does) with `Content-Type: text/javascript`.

## Slice 3 — Markdown and images

Verification: `npm test` 177/177 passed (outside the sandbox, as before);
`npm run typecheck` clean; `npm run build` clean. Manual checks (markdown
pages, diagram, theme, PNG via link) passed, confirmed by the human on
2026-10-05.

Deviations (small, two-way):

- Added `@types/markdown-it` 14.2.0 as a devDependency (markdown-it 15 ships
  no types); both installs ran outside the sandbox.
- `isViewable(name)` added next to `VIEWABLE` in `src/shared/artifactUrl.ts`,
  shared by the handler and `FeaturePage`.
- Broken frontmatter (`readFrontmatter` error) renders the whole source as
  markdown with no table, so nothing is hidden.
- The Mermaid scripts are added to a markdown page only when it has a
  `mermaid` fence.
- `respond` takes `string | Uint8Array<ArrayBuffer>` (a plain `Buffer` fails
  the `BodyInit` typecheck).
- The handler takes the extension from the requested path (already checked
  by `isViewable`), not the resolved file, so a symlink inside the folder to
  a non-viewable file can't be served with a missing MIME type. The guard is
  `!t || !file` so `t` narrows.
- The structure's "embedded `refs/xirp-reference.png` shows" is checked by
  following the link: no page embeds it with `<img>`; `04-structure.html`
  links it.

## Slice 4 — Navigation, switcher, Open review

Verification: `npm test` 185/185 passed (outside the sandbox, as before);
`npm run typecheck` clean; `npm run build` clean. Manual checks are for the
human.

Deviations (small, two-way):

- `guardNavigation` lets through a subframe `grove-artifact:` navigation whose
  target equals the current `ui.viewer` (all four fields). The renderer's own
  `src` change is renderer-initiated and may fire `will-frame-navigate`;
  cancelling it would stop the viewer loading anything. Every other artifact
  navigation is cancelled and routed through `uiSet`, as the design says.
- Main-frame navigation is compared without the `#fragment`.
- The dev-only `console.debug` logs the frame kind and scheme, never the path.
- `FileGroup` type exported from `viewerFiles.ts`; the switcher is a native
  `<select>` with `<optgroup>`s. A target in no group (sub-path, unknown
  feature) shows as a disabled first option.
- The old header title span is gone; the iframe keeps `title={target.path}`.
- The structure's Open review check named the discovery-sidebar feature, but
  it is done (no current stage, so no button). The manual check uses this
  feature instead (current stage implementation → `06-implementation.md`).

## Open questions
