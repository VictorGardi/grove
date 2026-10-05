import fs from 'node:fs'
import { protocol } from 'electron'
import { ARTIFACT_SCHEME, parseArtifactUrl } from '@shared/artifactUrl'
import type { Core } from '../core/core'

// Every response: no network, scripts only from bundled assets, opaque sandboxed origin (ADR 0007).
const CSP = "default-src 'none'; script-src grove-artifact://assets; style-src 'unsafe-inline' grove-artifact://assets; img-src grove-artifact: data:; font-src data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
const REFUSAL = '<!doctype html><meta charset="utf-8"><title>Not available</title>'
  + '<p>Not available in the viewer (outside the feature folders or not a viewable file)</p>'

const respond = (body: string, status: number) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP },
})

// Once, before app `ready`.
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true } }])
}

export function handleArtifacts(core: Core): void {
  protocol.handle(ARTIFACT_SCHEME, async (req) => {
    const t = parseArtifactUrl(req.url)
    const file = t && /\.html?$/i.test(t.path) ? core.artifactPath(t.projectId, t.slug, t.path) : null
    if (!file) return respond(REFUSAL, 404)
    try {
      return respond(await fs.promises.readFile(file, 'utf8'), 200)
    } catch {
      return respond(REFUSAL, 404)
    }
  })
}
