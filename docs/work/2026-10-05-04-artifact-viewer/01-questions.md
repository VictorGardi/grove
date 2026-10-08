---
feature: 2026-10-05-04-artifact-viewer
phase: questions
status: approved
version: 1
created: 2026-10-05
updated: 2026-10-05
approved_at: 2026-10-05
based_on:
  - parent:02-research.md@5
  - parent:03-design.md@5
  - parent:04-structure.md@5
forced: []
---

# Questions: artifact viewer

Child 4 of epic `2026-10-05-opencode-feature-workspace`. The epic's research
(v5, Q9 "Sandboxed artifact HTML in Electron") and design (v5) are inherited.
E-D8 (`grove-artifact://` scheme allowlisted to feature folders, header CSP,
bundled Mermaid, markdown rendered in main, opaque iframe) is settled and is
not re-asked here. Children 1, 9 and 2 have been built since the epic's
research, so the questions below cover the code as it is now, plus what
today's artifacts actually contain.

## Goal

Read any artifact of a feature safely inside the app.

## Out of scope

- The injected comment script and anything about comments (child 6)
- Next-action buttons on the feature page (child 5)
- Editing artifacts, or generating missing `.html` companions from the app
- Changes to the grove-skills repo (noted in `docs/skills-changes.md` only)

## Research questions

1. **Feature page today.** How does the renderer's feature page get a
   feature's artifact list from core (data shape, the `stage`/`role` tags,
   which files are included: hidden files, subfolders, non-markdown files),
   and what happens today when an artifact row is clicked?
2. **Renderer navigation.** How does the renderer switch between its views
   (sessions, feature page, board, terminal), where is that view state held,
   and how is per-viewer UI state persisted?
3. **Main process and window setup.** How is the main window created
   (`webPreferences`, session, preload), what CSP does the renderer page
   declare, how is the renderer loaded in dev versus a built app, and are any
   protocols or schemes registered or navigation/window-open handlers set
   today?
4. **Locating feature folders from main.** How do main and core know the
   discovered feature folders (project id, slug, absolute path), how could a
   `(project id, slug, file name)` triple be resolved to a path with what
   exists today, and how are file changes inside a feature folder (including
   `.html` files) observed and pushed to the renderer?
5. **`grove-render` output today.** What does a generated companion HTML
   contain (the template in the grove-render skill and an existing
   `02-research.html` / `03-design.html` in this repo): external resources
   (scripts, styles, fonts, images) with exact URLs and versions, how Mermaid
   is loaded and initialised, inline scripts and styles, and relative links?
6. **Markdown in artifacts.** Which markdown features do grove artifacts in
   this repo use (YAML frontmatter, tables, task lists, mermaid fences, HTML,
   relative links to other artifacts, ADRs or other repo files, anchors)?
   Where are the locations of linked repo-level files (ADR directory, domain
   glossary) declared in the repo's configuration?
7. **Electron 44 protocol and frame APIs.** For the installed Electron
   version: the exact `protocol.registerSchemesAsPrivileged` / `protocol.handle`
   signatures and behaviour, how response headers are set, how a header CSP
   with `sandbox` interacts with an iframe's `sandbox` attribute, whether a
   custom-scheme iframe loads inside a page served from the Vite dev server
   (`http://localhost`) and from a built app, and which events control
   navigation and `window.open` from inside subframes.
8. **Bundling assets for main.** How does electron-vite 5 ship static assets
   and npm packages used by main (`resources/`, `asarUnpack`, `?asset`
   imports, ESM/CJS), and in what form do the current `mermaid` and
   `markdown-it` npm packages publish a browser bundle that could be served as
   a file?
9. **Tests.** How are core and main currently tested (vitest setup, fakes),
   and is there any existing test coverage or harness for main-process or
   renderer code?

## Product questions for the human

1. **Open artifact changes on disk.** *Answer:* auto-reload in place as soon
   as the file changes, keeping the scroll position where possible.
2. **Links inside artifacts.** *Answer:* external `https://` links open in
   the system browser. Relative links to repo markdown outside the feature
   folder (ADRs, `CONTEXT.md`) open in the viewer, read-only, as deliberate
   exceptions to the feature-folder allowlist. Design must state how this
   widens E-D8's allowlist without opening arbitrary repo paths.
3. **Where an opened artifact appears.** *Answer:* in a resizable right-hand
   panel next to whatever the main area shows (terminal or feature page),
   with a toggle to expand it to fill the content area. Reason: read the
   artifact beside the running session; wide tables and Mermaid diagrams
   need the full-size option.
4. **Which files the switcher lists.** *Answer:* every viewable file in the
   feature folder tree, subfolders included (e.g. the epic's `refs/`):
   markdown, HTML, images. Files the workflow tags with a stage are grouped
   by stage.

## Size verdict

Not applicable: an epic child, bounded by the epic's structure (2 days,
about 4 slices).

## Open questions
