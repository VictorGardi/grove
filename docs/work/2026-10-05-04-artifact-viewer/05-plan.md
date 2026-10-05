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
- [x] Manual (human): open the epic's `03-design.html`
  (`2026-10-05-opencode-feature-workspace`) → both diagrams render; the
  DevTools Network tab shows no `jsdelivr` request; switch macOS appearance
  and reopen → the diagram theme follows.

## Slice 3 — Markdown and images

Context (code at `106a688`): `src/main/artifacts.ts` serves the `assets` host
from a `Map` of name → absolute file (`mermaid.min.js`, `mermaid-init.js`)
as `text/javascript`, and artifacts only when `/\.html?$/i` matches, through
`rewriteHtml`. `respond(body, status, type = 'text/html; charset=utf-8')`
always adds the CSP header. `src/core/artifacts/html.ts` exports
`MERMAID_SCRIPTS` (the two bundled `<script>` tags). The frontmatter splitter
is `readFrontmatter(text): { data, body, error }` in
`src/core/workflow/frontmatter.ts` (ADR 0013; `error` non-null on an unclosed
block, YAML error or non-mapping). `src/renderer/src/components/FeaturePage.tsx`
makes a Files row a `fileLink` button only for `/\.html?$/i`. markdown-it 15
ships no types: `@types/markdown-it` 14.2.0 provides them (devDependency). The
npm cache is not writable in the Claude Code sandbox: run installs outside it.
No grove-render page embeds an `<img>`; the epic's `04-structure.html` links
`refs/xirp-reference.png` with `<a href>`, so following that link loads the
image through the handler (navigation is not intercepted until slice 4).

- [x] Run `npm install --save-exact markdown-it@15.0.2` and
  `npm install --save-dev --save-exact @types/markdown-it@14.2.0`.
- [x] Write failing tests in `src/shared/artifactUrl.test.ts` (new `describe('isViewable')`):
  `true` for `'03-design.html'`, `'x.HTM'`, `'feature.md'`, `'refs/a.png'`,
  `'a.jpg'`, `'a.jpeg'`, `'a.gif'`, `'a.webp'`, `'a.svg'`; `false` for
  `'notes.txt'`, `'Makefile'`, `'a.md.bak'`, `'dir.d/x'`.
- [x] In `src/shared/artifactUrl.ts` add
  `export const VIEWABLE = ['.html', '.htm', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']`
  and `export function isViewable(name: string): boolean` →
  `const ext = /\.[^./]+$/.exec(name)?.[0].toLowerCase(); return ext !== undefined && VIEWABLE.includes(ext)`
  (no `node:path`: shared is compiled for the renderer too).
- [x] Run `npm test -- src/shared/artifactUrl.test.ts` → passes.
- [x] Write failing test `src/core/artifacts/markdown.test.ts` (`renderMarkdown`, plus `MERMAID_SCRIPTS` from `./html`):
  - frontmatter: `'---\nstatus: approved\nbased_on:\n  - a@1\n  - b@2\n---\n# Title\n'`
    (name `'03-design.md'`) contains `<table class="frontmatter">`,
    `<th>status</th><td>approved</td>`, `<th>based_on</th><td>a@1, b@2</td>`,
    `<h1>Title</h1>`, and not `status: approved`.
  - task list: `'- [x] done\n- [x] open\n'` contains
    `<input type="checkbox" disabled checked> done` and
    `<input type="checkbox" disabled> open`, contains `class="task-list-item"`,
    and not `[x]` or `[ ]`.
  - mermaid: `` '```mermaid\nflowchart LR\n  A-->B\n```\n' `` contains
    `<pre class="mermaid">flowchart LR\n  A--&gt;B\n</pre>` and `MERMAID_SCRIPTS`;
    `'# no diagram\n'` does not contain `mermaid.min.js`.
  - escaping: `'<script>alert(1)</script>\n'` does not contain `<script>alert`
    and contains `&lt;script&gt;alert(1)&lt;/script&gt;`.
  - frontmatter value escaping: `'---\ntitle: "<b>x</b>"\n---\n'` contains `&lt;b&gt;x&lt;/b&gt;`.
  - no frontmatter: the real `docs/work/2026-10-05-04-artifact-viewer/00-ticket.md`
    (read with `fs.readFileSync(path.resolve('docs/work/2026-10-05-04-artifact-viewer/00-ticket.md'), 'utf8')`,
    name `'00-ticket.md'`) starts with `<!doctype html>`, contains
    `<title>00-ticket.md</title>`, `<link rel="stylesheet" href="grove-artifact://assets/markdown.css">`,
    `<h3>`, and not `class="frontmatter"`.
  - broken frontmatter: `'---\na: [\n---\nbody\n'` contains `body` and not `class="frontmatter"`.
- [x] Create `src/core/artifacts/markdown.ts`:
  - `import MarkdownIt from 'markdown-it'`, `readFrontmatter` from `../workflow/frontmatter`,
    `MERMAID_SCRIPTS` from `./html`, `ARTIFACT_SCHEME, ASSETS_HOST` from `@shared/artifactUrl`.
  - `const md = new MarkdownIt('default', { html: false })`; `const esc = md.utils.escapeHtml`.
  - Task lists: `md.core.ruler.push('task_lists', (state) => { … })` — for each
    index `i >= 2` where `tokens[i].type === 'inline'`, `tokens[i - 1].type === 'paragraph_open'`,
    `tokens[i - 2].type === 'list_item_open'`, `/^\[([ xX])\] /` matches
    `tokens[i].content`, and `tokens[i].children?.[0]?.type === 'text'`: drop
    the first 4 characters of that text child's `content`, `unshift` a
    `new state.Token('html_inline', '', 0)` with `content`
    `` `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> ` ``
    into `children`, and `tokens[i - 2].attrJoin('class', 'task-list-item')`.
  - Mermaid fences: keep `const fence = md.renderer.rules.fence!`; set
    `md.renderer.rules.fence = (tokens, idx, opts, env, self) => tokens[idx].info.trim() === 'mermaid' ? `<pre class="mermaid">${esc(tokens[idx].content)}</pre>\n` : fence(tokens, idx, opts, env, self)`.
  - `fmValue(v: unknown): string` → arrays: items through `fmValue` joined with
    `', '`; `null`/`undefined` → `''`; other objects → `JSON.stringify(v)`;
    else `String(v)`.
  - `export function renderMarkdown(source: string, name: string): string`:
    `fm = readFrontmatter(source)`; `body = fm.error ? source : fm.body`;
    `entries = fm.error ? [] : Object.entries(fm.data)`; `table` =
    `''` when `entries` is empty, else
    `<table class="frontmatter"><tbody>` + per entry `<tr><th>${esc(k)}</th><td>${esc(fmValue(v))}</td></tr>` + `</tbody></table>`;
    `tokens = md.parse(body, {})`; `mermaid = tokens.some((t) => t.type === 'fence' && t.info.trim() === 'mermaid')`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><link rel="stylesheet" href="${ARTIFACT_SCHEME}://${ASSETS_HOST}/markdown.css">${mermaid ? MERMAID_SCRIPTS : ''}</head><body><main class="markdown-body">${table}${md.renderer.render(tokens, md.options, {})}</main></body></html>`.
- [x] Run `npm test -- src/core/artifacts/markdown.test.ts` → passes.
- [x] Create `resources/viewer/markdown.css` (`:root { color-scheme: light dark }`):
  custom properties `--fg #1f2328`, `--muted #59636e`, `--bg #ffffff`,
  `--subtle #f6f8fa`, `--border #d1d9e0`, `--link #0969da`, overridden in
  `@media (prefers-color-scheme: dark)` with `#e6edf3`, `#9198a1`, `#0d1117`,
  `#151b23`, `#3d444d`, `#4493f8`. `body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.6 system-ui, -apple-system, sans-serif }`;
  `.markdown-body { max-width: 860px; margin: 0 auto; padding: 24px 32px 48px }`;
  `a { color: var(--link) }`; `h1, h2 { padding-bottom: .3em; border-bottom: 1px solid var(--border) }`;
  `code, pre { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--subtle); border-radius: 6px }`;
  `code { padding: .15em .35em }`; `pre { padding: 12px 16px; overflow: auto }`; `pre code { padding: 0; background: none }`;
  `table { border-collapse: collapse; margin: 12px 0; display: block; overflow: auto }`;
  `th, td { border: 1px solid var(--border); padding: 4px 10px; text-align: left; vertical-align: top }`;
  `th { background: var(--subtle) }`; `table.frontmatter { font-size: 12.5px; color: var(--muted) }`;
  `blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: 3px solid var(--border) }`;
  `li.task-list-item { list-style: none }`; `li.task-list-item input { margin: 0 .4em 0 -1.3em }`;
  `pre.mermaid { background: none; text-align: center }`; `img { max-width: 100% }`;
  `hr { border: 0; border-top: 1px solid var(--border) }`.
- [x] In `src/main/artifacts.ts`:
  - Import `isViewable` from `@shared/artifactUrl` and `renderMarkdown` from `../core/artifacts/markdown`.
  - Add `const HTML = 'text/html; charset=utf-8'` (default `type` of `respond`) and
    `const MIME: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }`.
  - `respond` takes `body: string | Buffer`.
  - Assets map gains `['markdown.css', path.join(app.getAppPath(), 'resources', 'viewer', 'markdown.css')]`;
    asset responses use `MIME[path.extname(file)]` (Mermaid's `?asset` path ends in `.js`).
  - Artifact branch: `file = t && isViewable(t.path) ? core.artifactPath(t.projectId, t.slug, t.path) : null`;
    no `file` → `respond(REFUSAL, 404)`; `ext = path.extname(file).toLowerCase()`;
    inside the existing `try`: `.md` → `respond(renderMarkdown(await fs.promises.readFile(file, 'utf8'), path.posix.basename(t.path)), 200)`;
    `.html`/`.htm` → as today; else `respond(await fs.promises.readFile(file), 200, MIME[ext])`.
- [x] In `src/renderer/src/components/FeaturePage.tsx`: import `isViewable`
  from `@shared/artifactUrl` and use `isViewable(a.name)` in place of `/\.html?$/i.test(a.name)`.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- [x] Manual (human), `npm run dev`: open
  `2026-10-05-02-workflow-discovery-sidebar/05-plan.md` (frontmatter table,
  disabled checkboxes), this feature's `02-research.md` (its Mermaid diagram
  renders), and `00-ticket.md` (renders without a table); flip macOS
  appearance and reopen one → colours follow.
- [x] Manual (human): open the epic's `04-structure.html`, click the
  `refs/xirp-reference.png` link → the image shows in the panel.

## Slice 4 — Navigation, switcher, Open review

Context (code at `f6026c0`): `src/main/artifacts.ts` exports
`registerArtifactScheme`, `handleArtifacts(core)`; `src/main/index.ts` creates
`win` after `handleArtifacts(core)` and loads the renderer URL
(`ELECTRON_RENDERER_URL` in dev, `loadFile` otherwise). No
`will-navigate`/`setWindowOpenHandler` exists yet. `core.getSlices().ui.viewer`
is the open target; `core.commands.uiSet(partial)` sets it and pushes
`state:ui`, so the renderer's `ArtifactViewer` re-renders the iframe `src`
(`artifactUrl(target)`). `parseArtifactUrl` decodes segments and keeps `hash`
raw, so `parseArtifactUrl(artifactUrl(t))` equals `t`. A relative link such as
`../../adr/x.md` normalises under the standard scheme to
`grove-artifact://<pid>/adr/x.md` (slug `adr`, unknown → refusal page).
`FeaturesSlice.stages` is every workflow stage `{ id, label }` in order;
`Feature.stages` (effective) carry `artifact` and `review`; `Feature.currentStage`
is `null` when done; `Feature.artifacts` are top-level files
`{ name, stage, role }` (`stage` null when untagged). `isViewable` is in
`@shared/artifactUrl`. Renderer tests run in vitest/node
(`src/renderer/src/*.test.ts`). Tokens: `--card-border`, `--panel-bg`,
`--text`, `--text-2`, `--fs-sm`, `--sp-1..6`, `--r-md`.

The iframe guard must let the renderer's own load of `ui.viewer` through:
a subframe `grove-artifact:` navigation whose parsed target equals the current
`ui.viewer` (all four fields) proceeds; any other is cancelled and routed
through `uiSet`, after which the renderer's load matches and proceeds.

- [x] Write failing test `src/renderer/src/viewerFiles.test.ts` with a
  `feature(partial)` helper building a `Feature` (`projectId 'p'`, `slug 'f'`,
  `path '/x'`, `title 'f'`, `kind 'feature'`, `group false`, `parent null`,
  `flow null`, `cardState 'needs-review'`, `progress null`, `flags []`,
  `warnings []`, overridable `stages`, `currentStage`, `artifacts`). Stages
  `[{ id: 'questions', label: 'Questions' }, { id: 'research', label: 'Research' }, { id: 'design', label: 'Design' }]`.
  - `viewableFiles`: artifacts (in this order) `03-design.md` (design/artifact),
    `01-questions.md` (questions/artifact), `02-research.html` (research/review),
    `02-research.md` (research/artifact), `feature.md` (untagged),
    `notes.txt` (untagged), `00-ticket.md` (untagged) → exactly
    `[{ label: 'Questions', files: ['01-questions.md'] }, { label: 'Research', files: ['02-research.html', '02-research.md'] }, { label: 'Design', files: ['03-design.md'] }, { label: 'Other', files: ['feature.md', '00-ticket.md'] }]`.
  - a file tagged with a stage id not in `stages` (`stage: 'gone'`) lands in "Other".
  - no viewable files → `[]` (no empty groups).
  - `reviewTarget`: current stage `design` with `review: '03-design.html'` and
    both files present → `'03-design.html'`; review file absent →
    `'03-design.md'`; neither present → `null`; `currentStage: null` → `null`;
    stage with `review: null` and its artifact present → the artifact.
- [x] Create `src/renderer/src/viewerFiles.ts`:
  - `export type FileGroup = { label: string; files: string[] }`.
  - `export function viewableFiles(f: Feature, stages: { id: string; label: string }[]): FileGroup[]` →
    `files = f.artifacts.filter((a) => isViewable(a.name))`; per stage in
    `stages` order `{ label: st.label, files: files.filter((a) => a.stage === st.id).map((a) => a.name) }`;
    then `{ label: 'Other', files: <files whose stage is null or not a stages id> }`;
    drop groups with no files.
  - `export function reviewTarget(f: Feature): string | null` →
    `st = f.stages.find((s) => s.id === f.currentStage)`; `null` if none;
    `has = (n: string) => f.artifacts.some((a) => a.name === n)`;
    `st.review && has(st.review) ? st.review : has(st.artifact) ? st.artifact : null`.
- [x] Run `npm test -- src/renderer/src/viewerFiles.test.ts` → passes.
- [x] In `src/main/artifacts.ts`: import `BrowserWindow` (type) and `shell`
  from `electron`; add
  `const scheme = (url: string) => { try { return new URL(url).protocol } catch { return '' } }`,
  `const web = (url: string) => scheme(url) === 'http:' || scheme(url) === 'https:'`,
  and `export function guardNavigation(win: BrowserWindow, core: Core): void`:
  - `const wc = win.webContents`.
  - `wc.on('will-frame-navigate', (e) => { … })`:
    - when `!app.isPackaged`: `console.debug('[viewer] will-frame-navigate', e.isMainFrame ? 'main' : 'sub', scheme(e.url))` (no paths).
    - main frame: `if (e.url.split('#')[0] !== wc.getURL().split('#')[0]) e.preventDefault()`; return.
    - subframe, `scheme(e.url) === `${ARTIFACT_SCHEME}:``: `t = parseArtifactUrl(e.url)`,
      `cur = core.getSlices().ui.viewer`; if `t && cur` and `t.projectId === cur.projectId && t.slug === cur.slug && t.path === cur.path && t.hash === cur.hash` → return (the renderer loading `ui.viewer`);
      else `e.preventDefault()` and, when `t`, `void core.commands.uiSet({ viewer: t })`.
    - any other subframe URL: `e.preventDefault()`; if `web(e.url)` → `void shell.openExternal(e.url)`.
  - `wc.setWindowOpenHandler(({ url }) => { if (web(url)) void shell.openExternal(url); return { action: 'deny' } })`.
- [x] In `src/main/index.ts`: import `guardNavigation`; call
  `guardNavigation(win, core)` right after `new BrowserWindow(…)`, before `loadURL`/`loadFile`.
- [x] Replace `src/renderer/src/components/ArtifactViewer.tsx`:
  props `{ target: ViewerTarget; groups: FileGroup[]; onOpen: (path: string) => void; onClose: () => void }`.
  Header: a `<select className={s.switcher} aria-label="Artifact" value={target.path} onChange={(e) => onOpen(e.target.value)}>`
  holding, when `target.path` is in no group, first `<option value={target.path} disabled>{target.path}</option>`,
  then per group `<optgroup label={g.label}>` with `<option key={n} value={n}>{n}</option>` per file;
  then a spacer-free close `Button` as today. The iframe stays as is
  (`title={target.path}`). Remove the `.title` span and its CSS rule.
- [x] In `ArtifactViewer.module.css` add
  `.switcher { flex: 1; min-width: 0; height: 28px; padding: 0 var(--sp-2); font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--panel-bg); border: 1px solid var(--card-border); border-radius: var(--r-md) }`.
- [x] In `src/renderer/src/App.tsx`: import `viewableFiles` from `./viewerFiles`;
  `const v = ui.viewer`; `const viewerFeature = v && features.items.find((f) => f.projectId === v.projectId && f.slug === v.slug)`;
  pass to `ArtifactViewer` `groups={viewerFeature ? viewableFiles(viewerFeature, features.stages) : []}`
  and `onOpen={(path) => openArtifact({ projectId: v.projectId, slug: v.slug, path, hash: null })}`.
- [x] In `src/renderer/src/components/FeaturePage.tsx`: import `Button` from
  `./ui/Button` and `reviewTarget` from `../viewerFiles`; `const review = reviewTarget(f)`;
  in the header, after the title, render
  `{review && <div className={s.actions}><Button size="sm" onClick={() => onOpenArtifact(review)}>Open review</Button></div>}`.
  In `FeaturePage.module.css` add `.actions { display: flex; gap: var(--sp-2) }`.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run build`
- [x] Manual (human), `npm run dev`, in
  `2026-10-05-02-workflow-discovery-sidebar/03-design.html`: the terminal
  running `npm run dev` shows `[viewer] will-frame-navigate sub grove-artifact:`
  lines; click the "Part of epic" link → the epic's `03-design.html` opens and
  the switcher lists the epic's files; click an ADR link → refusal page; pick
  another file in the switcher → it opens.
- [x] Manual (human): **Open review** on this feature
  (`2026-10-05-04-artifact-viewer`, current stage implementation, no review
  file) opens `06-implementation.md`; on `2026-10-05-02-workflow-discovery-sidebar`
  (done) there is no button.
- [x] Manual (human): add `[x](https://example.com)` to a scratch `.md` in a
  feature folder, open it, click → opens in the system browser, the panel
  stays put. Delete the scratch file afterwards.
- [x] Manual (human): if no `will-frame-navigate … sub` line appears, stop:
  the design's `did-frame-navigate` fallback replaces the subframe branch
  before this slice is ticked.

## Open questions
