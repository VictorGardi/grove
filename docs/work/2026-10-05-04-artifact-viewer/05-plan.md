---
feature: 2026-10-05-04-artifact-viewer
phase: plan
status: approved
version: 2
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: artifact viewer

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Tracer: an HTML artifact opens in the panel

Context (code at `5d06037`): `Feature.path` is the feature folder's absolute
path and `slices.features.items` holds exactly the discovered features
(`src/core/core.ts` `publish()`). `uiSet` merges a partial over `slices.ui`
and persists it; `loadState` merges saved `ui` over `DEFAULT_UI`
(`src/core/store/stateStore.ts:6`), so a new key with a default needs no
schema bump. `src/shared/**` is compiled by both the node and web tsconfigs:
no `node:` imports there. Tests run in vitest/node, `src/**/*.test.ts`;
`setupCore()` (`src/core/testing/setup.ts`) makes a temp project `p` at `dir`
with the bundled workflow, whose discovery root is `docs/work` and manifest
`feature.md`. Renderer `.tsx` files may not use visual inline styles
(`noInlineStyles.test.ts`). In slice 1 only `.html`/`.htm` are served and
clickable; markdown and images arrive in slice 3.

- [x] Add to `src/shared/types.ts`:
  `export interface ViewerTarget { projectId: string; slug: string; path: string; hash: string | null }`
  (`path`: relative POSIX path inside the feature folder; `hash`: fragment
  without the leading `#`), `UiState.viewer: ViewerTarget | null`, and
  `viewer: null` in `DEFAULT_UI`.
- [x] Write failing test `src/shared/artifactUrl.test.ts`:
  - `artifactUrl({ projectId: 'p1', slug: 'my-feat', path: 'refs/a b.html', hash: 'q1-x' })`
    is `'grove-artifact://p1/my-feat/refs/a%20b.html#q1-x'`; with `hash: null`
    there is no `#`.
  - round trip: `parseArtifactUrl(artifactUrl(t))` equals `t` for paths
    `'03-design.html'`, `'a b/c d.html'`, `'x#y.html'` (the `#` in a file
    name is percent-encoded), each with `hash` `null` and `'sec-2'`.
  - `parseArtifactUrl` returns `null` for `'grove-artifact://assets/mermaid.min.js'`,
    `'https://p1/s/x.html'`, `'grove-artifact://p1/s'` (no path),
    `'grove-artifact://p1/s/'` (empty path), and `'not a url'`.
- [x] Create `src/shared/artifactUrl.ts`:
  - `export const ARTIFACT_SCHEME = 'grove-artifact'` and
    `export const ASSETS_HOST = 'assets'`.
  - `artifactUrl(t)`: `` `${ARTIFACT_SCHEME}://${t.projectId}/${encodeURIComponent(t.slug)}/${t.path.split('/').map(encodeURIComponent).join('/')}` ``
    plus `` `#${t.hash}` `` when `t.hash !== null`.
  - `parseArtifactUrl(url)`: `new URL(url)` inside `try` (catch → `null`);
    `null` unless `u.protocol === 'grove-artifact:'` and `u.host` is non-empty
    and not `ASSETS_HOST`; split `u.pathname.slice(1)` on `/`, map
    `decodeURIComponent` (a throw → `null`); first segment is `slug`, the rest
    joined with `/` is `path`; `null` if `slug` or `path` is empty; `hash` is
    `u.hash ? u.hash.slice(1) : null`; `projectId` is `u.host`.
- [x] Run `npm test -- src/shared/artifactUrl.test.ts` → passes.
- [x] Write failing test `src/core/artifacts/path.test.ts` using `setupCore()`
  (`afterEach` → `disposeAll`). Fixture under `dir`: `docs/work/a/feature.md`
  (`---\nkind: feature\n---\n# a\n`), `docs/work/a/03-design.html`,
  `docs/work/a/refs/x.png`, `docs/work/a/.hidden.html`,
  `docs/work/a/.dot/x.html`, directory `docs/work/a/dir.html/`,
  `dir/outside.html` (outside the feature folder), and a symlink
  `docs/work/a/link.html` → `dir/outside.html` (absolute target). Start a
  core, then assert `core.artifactPath('p', 'a', rel)`:
  - `'03-design.html'` → `fs.realpathSync` of that file; `'refs/x.png'` → its realpath.
  - `null` for: `'../../../outside.html'`, `'refs/../../a/03-design.html'`,
    absolute `path.join(dir, 'outside.html')`, `'refs\\x.png'`,
    `'.hidden.html'`, `'.dot/x.html'`, `'link.html'`, `'dir.html'`,
    `'missing.html'`, `''`.
  - `core.artifactPath('p', 'nope', '03-design.html')` and
    `core.artifactPath('other', 'a', '03-design.html')` → `null`.
  - encoded traversal through the URL parser: for
    `'grove-artifact://p/a/%2e%2e/%2e%2e/outside.html'` and
    `'grove-artifact://p/a/..%2F..%2F..%2Foutside.html'`, `parseArtifactUrl`
    gives `t`, and `t === null || core.artifactPath(t.projectId, t.slug, t.path) === null`.
  - Also direct `safeArtifactPath(path.join(dir, 'docs/work/a'), '03-design.html')`
    returns the realpath (unit of the pure function).
- [x] Create `src/core/artifacts/path.ts`:
  `export function safeArtifactPath(folder: string, rel: string): string | null`
  — `null` if `rel` is empty, `path.isAbsolute(rel)`, contains `\`, or any
  `rel.split('/')` segment starts with `.`; then in `try` (catch → `null`):
  `root = fs.realpathSync(folder)`, `real = fs.realpathSync(path.join(root, rel))`,
  `null` unless `real.startsWith(root + path.sep)`, return
  `fs.statSync(real).isFile() ? real : null`.
- [x] In `src/core/core.ts`: import `safeArtifactPath`; add to `interface Core`
  `artifactPath(projectId: string, slug: string, rel: string): string | null`;
  implement in the returned object as
  `const f = slices.features.items.find((x) => x.projectId === projectId && x.slug === slug); return f ? safeArtifactPath(f.path, rel) : null`.
- [x] Run `npm test -- src/core/artifacts/path.test.ts` → passes.
- [x] Create `src/main/artifacts.ts`:
  - `const CSP = "default-src 'none'; script-src grove-artifact://assets; style-src 'unsafe-inline' grove-artifact://assets; img-src grove-artifact: data:; font-src data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"`.
  - `const REFUSAL` = a small HTML document (`<!doctype html><meta charset="utf-8"><title>Not available</title>` + a `<p>` with
    "Not available in the viewer (outside the feature folders or not a viewable file)").
  - `respond(body: string, status: number)` → `new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP } })`.
  - `export function registerArtifactScheme(): void` →
    `protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true } }])`.
  - `export function handleArtifacts(core: Core): void` →
    `protocol.handle(ARTIFACT_SCHEME, async (req) => …)`: `t = parseArtifactUrl(req.url)`;
    `file = t && /\.html?$/i.test(t.path) ? core.artifactPath(t.projectId, t.slug, t.path) : null`;
    no `file` → `respond(REFUSAL, 404)`; else `respond(await fs.promises.readFile(file, 'utf8'), 200)`,
    a read error → `respond(REFUSAL, 404)`. No logging of paths.
- [x] In `src/main/index.ts`: call `registerArtifactScheme()` at module top
  level (before `app.whenReady()`), and `handleArtifacts(core)` right after
  `await core.start()`.
- [x] In `src/renderer/index.html`: append `; frame-src grove-artifact:` to
  the meta CSP `content`.
- [x] In `src/renderer/src/stores/slices.ts`: add
  `openArtifact(t: ViewerTarget): void` → `ui:set { viewer: t }` and
  `closeViewer(): void` → `ui:set { viewer: null }`.
- [x] Create `src/renderer/src/components/ArtifactViewer.tsx` (+
  `ArtifactViewer.module.css`): `ArtifactViewer({ target, onClose })` renders
  a column: header row (`target.path` as the title, ellipsised; a
  `Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer"`
  calling `onClose`) and `<iframe className={s.frame} sandbox="allow-scripts" src={artifactUrl(target)} title={target.path} />`.
  CSS: `.viewer` flex column filling its parent; `.header` height
  `var(--header-h)`, padding `0 var(--sp-3)`, `display:flex; align-items:center; gap: var(--sp-2)`,
  bottom border `1px solid var(--card-border)`; `.title` `flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size: var(--fs-sm); color: var(--text-2)`;
  `.frame` `flex:1; width:100%; border:0; background: var(--panel-bg)`.
- [x] In `src/renderer/src/components/shell/AppShell.tsx`: add optional prop
  `viewer?: ReactNode`; after `<main>` render
  `{viewer && <aside className={s.viewer}>{viewer}</aside>}`. In
  `AppShell.module.css` add `.viewer` to the `.sidebar, .content` panel rule
  and `.viewer { width: 480px; flex-shrink: 0; display: flex; flex-direction: column }`.
- [x] In `src/renderer/src/components/FeaturePage.tsx`: add prop
  `onOpenArtifact: (name: string) => void`; in the Files list render the name
  as `<button type="button" className={s.fileLink} onClick={() => onOpenArtifact(a.name)}>`
  when `/\.html?$/i.test(a.name)`, else the existing `<span>`. In
  `FeaturePage.module.css` add `.fileLink { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; text-align: left }`
  and `.fileLink:hover { text-decoration: underline }`.
- [x] In `src/renderer/src/App.tsx`: take `openArtifact, closeViewer` from
  `useSlices()`; pass `onOpenArtifact={(name) => openArtifact({ projectId: focusedFeature.projectId, slug: focusedFeature.slug, path: name, hash: null })}`
  to `FeaturePage`, and
  `viewer={ui.viewer ? <ArtifactViewer target={ui.viewer} onClose={closeViewer} /> : undefined}`
  to `AppShell`.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- [x] Manual (human), `npm run dev`: open `2026-10-05-02-workflow-discovery-sidebar`
  → click `03-design.html` → the page renders in the panel (diagrams may be
  blank). In the panel's DevTools console, `location.origin` is `"null"`.
- [x] Manual (human): same check after `npm run build && npm start`.
- [x] Manual (human): set the iframe `src` in DevTools to
  `grove-artifact://<pid>/<slug>/../../../../etc/hosts` → refusal page.

## Slice 2 — Mermaid offline

Context (code at `2d5dc5d`): `src/main/artifacts.ts` has `CSP`, `REFUSAL`,
`respond(body, status)` (always `text/html`) and `handleArtifacts(core)`,
which serves only `.html`/`.htm` via `parseArtifactUrl` (that returns `null`
for the `assets` host). `src/shared/artifactUrl.ts` exports `ARTIFACT_SCHEME`
and `ASSETS_HOST`. grove-render pages load
`<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>`
in `<head>` and call `mermaid.initialize(...)` from an inline script at the
end of `<body>` (blocked by the CSP). Mermaid's `startOnLoad` renders
`.mermaid` elements on the window `load` event, so initializing from `<head>`
works. `tsconfig.node.json` includes `electron-vite/node` types, which declare
`*?asset` imports (an absolute path string at runtime). Main finds bundled
files with `path.join(app.getAppPath(), 'resources', …)` (`src/main/index.ts`).
`mermaid/dist/mermaid.min.js` is a single IIFE setting `globalThis.mermaid`,
reachable via the package's `"./*"` export. The npm cache is not writable in
the Claude Code sandbox: run the install outside it.

- [x] Run `npm install --save-dev --save-exact mermaid@12.1.0` (adds
  `"mermaid": "12.1.0"` to `devDependencies` and updates `package-lock.json`).
- [x] Write failing test `src/core/artifacts/html.test.ts`:
  - the grove-render head
    `<head><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script></head>`
    through `rewriteHtml` contains
    `<script src="grove-artifact://assets/mermaid.min.js"></script><script src="grove-artifact://assets/mermaid-init.js"></script>`
    and no `cdn.jsdelivr.net`.
  - same for `https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js`.
  - `'<html><body><p>no diagrams</p></body></html>'` comes back unchanged.
- [x] Create `src/core/artifacts/html.ts`:
  - `export const MERMAID_SCRIPTS` = the two tags above, built from
    `` `${ARTIFACT_SCHEME}://${ASSETS_HOST}/…` `` (imported from `@shared/artifactUrl`).
  - `export function rewriteHtml(html: string): string` →
    `html.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@[^"]*"\s*><\/script>/g, MERMAID_SCRIPTS)`.
- [x] Run `npm test -- src/core/artifacts/html.test.ts` → passes.
- [x] Create `resources/viewer/mermaid-init.js`: a comment line saying it
  replaces the page's inline init (blocked by the CSP), then
  `mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' })`.
- [x] In `src/main/artifacts.ts`:
  - `import mermaidJs from 'mermaid/dist/mermaid.min.js?asset'`, `import path from 'node:path'`,
    `app` from `electron`, `ASSETS_HOST` from `@shared/artifactUrl`,
    `rewriteHtml` from `../core/artifacts/html`.
  - `respond(body: string, status: number, type = 'text/html; charset=utf-8')`
    — `type` becomes the `Content-Type`; the CSP header stays on every response.
  - In `handleArtifacts`, before the handler:
    `const assets = new Map([['mermaid.min.js', mermaidJs], ['mermaid-init.js', path.join(app.getAppPath(), 'resources', 'viewer', 'mermaid-init.js')]])`.
  - At the start of the handler: `const u = new URL(req.url)`; if
    `u.host === ASSETS_HOST`: `file = assets.get(u.pathname.slice(1))`; no
    `file` → `respond(REFUSAL, 404)`; else
    `respond(await fs.promises.readFile(file, 'utf8'), 200, 'text/javascript; charset=utf-8')`
    (a read error → `respond(REFUSAL, 404)`).
  - HTML branch: respond with `rewriteHtml(await fs.promises.readFile(file, 'utf8'))`.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`; then `ls out/main/chunks` shows a `mermaid.min-*.js`.
- [ ] Manual (human): open the epic's `03-design.html`
  (`2026-10-05-opencode-feature-workspace`) → both diagrams render; the
  DevTools Network tab shows no `jsdelivr` request; switch macOS appearance
  and reopen → the diagram theme follows.

## Open questions
