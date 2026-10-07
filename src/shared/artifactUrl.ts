import type { ArtifactTarget, DocTarget } from './types'

export const ARTIFACT_SCHEME = 'grove-artifact'
export const ASSETS_HOST = 'assets' // bundled viewer assets; project ids are UUIDs, so no clash
export const VIEWABLE = ['.html', '.htm', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

// By extension only; no node:path here, shared is compiled for the renderer too.
export function isViewable(name: string): boolean {
  const ext = /\.[^./]+$/.exec(name)?.[0].toLowerCase()
  return ext !== undefined && VIEWABLE.includes(ext)
}

// grove-artifact://<projectId>/<slug>/<path>#<hash>
export function artifactUrl(t: DocTarget): string {
  if (t.kind !== 'artifact') throw new Error(`no URL for a ${t.kind} target`)
  const path = t.path.split('/').map(encodeURIComponent).join('/')
  const url = `${ARTIFACT_SCHEME}://${t.projectId}/${encodeURIComponent(t.slug)}/${path}`
  return t.hash !== null ? `${url}#${t.hash}` : url
}

// null for the assets host, another scheme, a missing slug or path, or a bad URL.
export function parseArtifactUrl(url: string): ArtifactTarget | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${ARTIFACT_SCHEME}:` || !u.host || u.host === ASSETS_HOST) return null
    const [slug, ...rest] = u.pathname.slice(1).split('/').map(decodeURIComponent)
    const path = rest.join('/')
    if (!slug || !path) return null
    return { kind: 'artifact', projectId: u.host, slug, path, hash: u.hash ? u.hash.slice(1) : null, fromDiff: null }
  } catch {
    return null
  }
}
