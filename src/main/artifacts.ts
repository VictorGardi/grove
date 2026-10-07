import fs from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow, protocol, shell } from 'electron'
import mermaidJs from 'mermaid/dist/mermaid.min.js?asset'
import { ARTIFACT_SCHEME, ASSETS_HOST, isViewable, parseArtifactUrl } from '@shared/artifactUrl'
import { rewriteHtml } from '../core/artifacts/html'
import { renderMarkdown } from '../core/artifacts/markdown'
import type { DocTarget, ViewerTarget } from '@shared/types'
import type { Core } from '../core/core'

// Every response: no network, scripts only from bundled assets, opaque sandboxed origin (ADR 0007).
const CSP = "default-src 'none'; script-src grove-artifact://assets; style-src 'unsafe-inline' grove-artifact://assets; img-src grove-artifact: data:; font-src data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
const REFUSAL = '<!doctype html><meta charset="utf-8"><title>Not available</title>'
  + '<p>Not available in the viewer (outside the project or not a viewable file)</p>'

const HTML = 'text/html; charset=utf-8'
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const respond = (body: string | Uint8Array<ArrayBuffer>, status: number, type = HTML) => new Response(body, {
  status,
  headers: { 'Content-Type': type, 'Content-Security-Policy': CSP },
})

// Once, before app `ready`.
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true } }])
}

export function handleArtifacts(core: Core): void {
  const assets = new Map([
    ['mermaid.min.js', mermaidJs],
    ['mermaid-init.js', path.join(app.getAppPath(), 'resources', 'viewer', 'mermaid-init.js')],
    ['comments.js', path.join(app.getAppPath(), 'resources', 'viewer', 'comments.js')],
    ['markdown.css', path.join(app.getAppPath(), 'resources', 'viewer', 'markdown.css')],
  ])

  protocol.handle(ARTIFACT_SCHEME, async (req) => {
    const u = new URL(req.url)
    if (u.host === ASSETS_HOST) {
      const file = assets.get(u.pathname.slice(1))
      if (!file) return respond(REFUSAL, 404)
      try {
        return respond(await fs.promises.readFile(file, 'utf8'), 200, MIME[path.extname(file)])
      } catch {
        return respond(REFUSAL, 404)
      }
    }
    const t = parseArtifactUrl(req.url)
    const file = !t || !isViewable(t.path) ? null
      : t.kind === 'file' ? core.filePath(t.projectId, t.path) : core.artifactPath(t.projectId, t.slug, t.path)
    if (!t || !file) return respond(REFUSAL, 404)
    const ext = path.extname(t.path).toLowerCase() // the checked name, not a symlink target's
    try {
      if (ext === '.md') return respond(renderMarkdown(await fs.promises.readFile(file, 'utf8'), path.posix.basename(t.path)), 200)
      if (ext === '.html' || ext === '.htm') return respond(rewriteHtml(await fs.promises.readFile(file, 'utf8')), 200)
      return respond(await fs.promises.readFile(file), 200, MIME[ext])
    } catch {
      return respond(REFUSAL, 404)
    }
  })
}

const scheme = (url: string) => {
  try {
    return new URL(url).protocol
  } catch {
    return ''
  }
}
const web = (url: string) => scheme(url) === 'http:' || scheme(url) === 'https:'

const sameDoc = (a: DocTarget, b: ViewerTarget | null) => b !== null && b.kind === a.kind && a.projectId === b.projectId
  && a.path === b.path && a.hash === b.hash && (a.kind !== 'artifact' || (b.kind === 'artifact' && a.slug === b.slug))

// The viewer frame follows ui.viewer: artifact links go through uiSet, http(s) to the browser,
// everything else is denied. The renderer's own load of ui.viewer is the one navigation let through.
export function guardNavigation(win: BrowserWindow, core: Core): void {
  const wc = win.webContents
  wc.on('will-frame-navigate', (e) => {
    if (!app.isPackaged) console.debug('[viewer] will-frame-navigate', e.isMainFrame ? 'main' : 'sub', scheme(e.url))
    if (e.isMainFrame) {
      if (e.url.split('#')[0] !== wc.getURL().split('#')[0]) e.preventDefault()
      return
    }
    if (scheme(e.url) === `${ARTIFACT_SCHEME}:`) {
      const t = parseArtifactUrl(e.url)
      const cur = core.getSlices().ui.viewer
      if (t && sameDoc(t, cur)) return
      e.preventDefault()
      // a followed link keeps "← Diff"
      if (t) void core.commands.uiSet({ viewer: { ...t, fromDiff: cur && cur.kind !== 'diff' ? cur.fromDiff : null } })
      return
    }
    e.preventDefault()
    if (web(e.url)) void shell.openExternal(e.url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (web(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}
