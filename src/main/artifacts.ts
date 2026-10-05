import fs from 'node:fs'
import path from 'node:path'
import { app, protocol } from 'electron'
import mermaidJs from 'mermaid/dist/mermaid.min.js?asset'
import { ARTIFACT_SCHEME, ASSETS_HOST, isViewable, parseArtifactUrl } from '@shared/artifactUrl'
import { rewriteHtml } from '../core/artifacts/html'
import { renderMarkdown } from '../core/artifacts/markdown'
import type { Core } from '../core/core'

// Every response: no network, scripts only from bundled assets, opaque sandboxed origin (ADR 0007).
const CSP = "default-src 'none'; script-src grove-artifact://assets; style-src 'unsafe-inline' grove-artifact://assets; img-src grove-artifact: data:; font-src data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
const REFUSAL = '<!doctype html><meta charset="utf-8"><title>Not available</title>'
  + '<p>Not available in the viewer (outside the feature folders or not a viewable file)</p>'

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
    const file = t && isViewable(t.path) ? core.artifactPath(t.projectId, t.slug, t.path) : null
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
