---
feature: 2026-10-26-artifacts-canvas
phase: research
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: []
forced: []
repo_heads: [adc94525311360850034bca01ce576609be8992c]
---

# Research: artifacts canvas

Facts only. Merged from two read-only researchers (renderer/UI and data/main).

## Headline

There is no dedicated "artifacts page" today. The nearest surfaces are the Files list on the Feature page, the Project page board (feature cards) and the right-hand ArtifactViewer panel. Nothing renders a grid, card or thumbnail of artifacts. There is no pan, zoom or canvas code and no canvas/zoom/flow dependency (no d3, konva, react-flow).

## UI map (renderer, `src/renderer/src`)

- Page switching is not a router: `ui` state (zustand, mirrored from main) decides what shows. `content(...)` and the JSX switch are in `App.tsx` (~L56-85): `project`, `feature`, `grid`, `session`, empty. Feature page is reached via `focusFeature` (`stores/slices.ts` L26) from a board card or sidebar; header crumbs navigate up.
- `components/FeaturePage.tsx` (107 lines): header with "Open review" (`reviewTarget`, `viewerFiles.ts` L17); "Files" section L65-77 renders `f.artifacts` as a plain list, a button for viewable files (opens the viewer via `onOpenArtifact`) and a span otherwise, with a stage note and "· review". Other sections: Stages, Children, Sessions.
- `ProjectPage.tsx` renders Board / SessionsBoard; it shows no artifacts.
- Each item today shows only a file name and stage note. Click opens it in the right-hand viewer via `openArtifact({kind:'file', projectId, path, hash:null, fromDiff:null})`.
- `components/ArtifactViewer.tsx` (118 lines): `<iframe sandbox="allow-scripts" src={artifactUrl(target)}>` (opaque origin, ADR 0007); header has a stage-grouped file `<select>`, `ReviewMenu`, expand and close. Markdown, HTML and images all load through `grove-artifact://<projectId>/<path>#hash`.
- Layout: `components/shell/AppShell.tsx` puts the viewer in an `<aside>` right of `<main>` with a splitter; `ui.viewerWidth` is saved (null = 33vw); `ui.viewerExpanded` makes it fill the content area and hides the content, the nearest existing "full page" concept.
- Comments: only `.md` is commentable (`artifactComments.ts`); `resources/viewer/comments.js` runs inside the frame and postMessages `ready|select|open`; the viewer accepts messages only from its own frame; `CommentEditor` overlay at viewer bottom; reload on mtime change (`reloadViewer`).
- Viewable extensions: `.html .htm .md .png .jpg .jpeg .gif .webp .svg` (`src/shared/artifactUrl.ts` L5).
- Other entry points to the viewer: ReviewTray quotes, diff "rendered" files, links clicked inside the iframe (`src/main/artifacts.ts` `guardNavigation` L83-108), palette actions.

## State and styling

- One zustand store `useSlices` (`stores/slices.ts`) mirrors main snapshots (ADR 0011). Persisted UI lives in `UiState`/`DEFAULT_UI` (`src/shared/types.ts` ~L97-172), written with `window.api.invoke('ui:set', Partial<UiState>)` and merged by `core.commands.uiSet` (`core.ts` L1044), pushed as `state:ui`, saved by `stateStore.ts` (schemaVersion 10; additive optional fields need no migration; precedent for per-key maps: `diffPrefs?`, `recentBases?`, `compact?`, `grid.tracks`; ADR 0031 grid state in ui).
- Styling (ADR 0012): CSS Modules + tokens in `styles/tokens.css` (`--panel-bg --card-bg --card-border --glass-* --text* --accent --fs-* --sp-* --r-*`), dark theme only. `noInlineStyles.test.ts` allows `style=` only as object literals whose keys all start with `--`, so a pan/zoom transform must pass as CSS variables.
- UI primitives in `components/ui/`: Badge, Banner, Button, ContextMenu, Icon, ListRow, Modal, Spinner, StatusDot, Tag, WorkflowStatusPicker, `cx`.
- Existing pointer code: splitters in `AppShell.tsx` (`setPointerCapture`), pane drag in `SessionGrid.tsx`, ordering in `Sidebar.tsx`. No `onWheel`, pan or zoom code anywhere.

## Data and main map

- Discovery: `resources/workflow.yaml` (`discovery.manifest: feature.md`, root from `grove.config.json` `artifactRoot`). `src/core/discovery/folder.ts` `readFolder` returns top-level non-dot files, mtimes, manifest and stage-file frontmatter only. `src/core/workflow/derive.ts` `deriveFeatures` builds `Feature` with `artifacts: {name, stage, role: 'artifact'|'review'|null, mtimeMs}[]`, `stages[]`, `currentStage`, `path`, `slug`, `title`, `kind`, `flow`, `parent`.
- An artifact has no per-file status in the slice (status lives in file frontmatter, read only for stage completion). The html companion is another entry with `role: 'review'`. Nothing returns a file body or frontmatter to the renderer; there is no list/read/render IPC for artifacts (metadata arrives via the `state:features` push).
- Preload (`src/preload/index.ts`) exposes generic `window.api.{invoke,send,on}`; channel types in `src/shared/ipc.ts`.
- Protocol: `src/main/artifacts.ts` `grove-artifact` scheme: `.md` through `renderMarkdown` (`src/core/artifacts/markdown.ts`), `.html` through `rewriteHtml` (`html.ts`), images raw; strict CSP (`default-src 'none'`, scripts only from `grove-artifact://assets`, `img-src grove-artifact: data:`, `sandbox allow-scripts`). `safeArtifactPath` (`src/core/artifacts/path.ts`) refuses dotted segments, symlink escape, non-files.
- Watching: chokidar `watchRoot` (`src/core/discovery/watcher.ts`) emits per changed feature folder, then `rereadFolder` and `publish()` push fresh `state:features` with new `mtimeMs`.
- Thumbnails: none exist (no `capturePage`, no image generation). Same-scheme sandboxed iframes already work under the CSP, one real render per card for HTML artifacts (which may load mermaid).

## Tests and commands

- `npm test` (vitest run, node environment, `src/**/*.test.ts` only, aliases `@shared`, `@renderer`), `npm run typecheck`, `npm run build`, `npm run dev`.
- Logic lives in pure `.ts` modules with sibling tests (`gridView.ts`, `viewerFiles.ts`); component tests use `renderToStaticMarkup` (`boardRender.test.ts`, `projectPageRender.test.ts`). No jsdom or testing-library.
- Shared and renderer code must not use `node:path`.
- Relevant ADRs: 0007, 0009, 0011, 0012, 0022, 0026, 0031, 0032.

## Comments and session routing (today)

- A `Comment` (`src/shared/types.ts` L150-166) is owned by a `sessionId`; it has no feature slug. Anchors: `diff` (root, path, side, lines), `file` (projectId, path, exact/prefix/suffix quote; used for `.md` artifacts), `note` (one general note draft per session). Store: `<userData>/comments.json` (`src/core/comments/store.ts`), pushed as the `comments` slice; file anchors are re-anchored on artifact mtime change (`core.ts` L344-368).
- Send: `review:send {sessionId}` runs `core.commands.reviewSend` (`core.ts` L1124-1146): collects that session's drafts, formats them (`src/core/comments/format.ts`: "Review comments from Grove (N)", note, then a `## path` section per file with `L3-5, on "<quote>":` blocks), delivers via `sendToSession` (`src/core/send.ts`): tmux bracketed paste plus Enter, agent-neutral (ADR 0023); a gone session is resumed first (terminal sessions or sessions without an agent session id return `gone`); errors `busy`, `empty`, `not-found`, `not-ready`.
- Diff view: viewer target `{kind:'diff', sessionId}`, opened from a focused session's header "Diff" button, so a diff is tied to one session; comments are filtered by that session. `saveAndSend` sends to `focusedSessionId ?? sessionId`.
- Artifact viewer: `sessionId = target.fromDiff ?? focusedSessionId` (`ArtifactViewer.tsx` L37). `fromDiff` is set only when a rendered file is opened from a diff. On the Feature or Project page no session is focused (focuses are exclusive), so `sessionId` is null: no ReviewMenu, `canComment:false`, no drafts. Commenting on artifacts is unavailable without a focused session. Only `.md` is commentable.
- Saving uses the viewed session; sending uses `focusedSessionId ?? sessionId` (intentional per comment at `ReviewTray.tsx` L54-55; format allows drafts spanning checkouts).
- Sessions and features: `Session.feature: string|null` (slug in the session's own project) and `linkPinned`; unpinned agent sessions auto-follow the feature folder they last wrote to (`autolink.ts`, ADR 0006); manual link via `session:link` and `LinkPicker`. `Feature` has no sessions field; sessions are joined by `s.feature === slug` (`FeaturePage.tsx` L23-25, across the repo's worktree checkouts). A feature can have zero, one or several sessions; nothing picks among them (the Feature page shows "No linked sessions" or one row per session).
- Session record: id, projectId, kind (opencode|claude|copilot|terminal), label, workflowStatus, tmuxName, cwd, agentSessionId, feature, linkPinned, startedAt/endedAt, lastStatus, parentId, lastFocusedAt (`types.ts` L11-41). A worktree is its own project (ADR 0037).
- Session choosers today: sidebar list, SessionsBoard, palettes, session grid, Feature page rows, `LinkPicker`.
- ADRs: 0023, 0024, 0025, 0026, 0008, 0006, 0020, 0021, 0032, 0037, 0017, 0029. Tests: `src/core/comments/*.test.ts`, `artifactComments.test.ts`, `reviewView.test.ts`.

## Open questions
