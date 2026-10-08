import type { DocTarget } from './types'

export const ARTIFACT_SCHEME = 'grove-artifact'
export const ASSETS_HOST = 'assets' // bundled viewer assets; project ids are UUIDs, so no clash
export const VIEWABLE = ['.html', '.htm', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

// By extension only; no node:path here, shared is compiled for the renderer too.
export function isViewable(name: string): boolean {
  const ext = /\.[^./]+$/.exec(name)?.[0].toLowerCase()
  return ext !== undefined && VIEWABLE.includes(ext)
}

// grove-artifact://<projectId>/<path>#<hash>, the path relative to the project folder (ADR 0032)
export function artifactUrl(t: DocTarget): string {
  const url = `${ARTIFACT_SCHEME}://${t.projectId}/${t.path.split('/').map(encodeURIComponent).join('/')}`
  return t.hash !== null ? `${url}#${t.hash}` : url
}

// null for the assets host, another scheme, a missing path, or a bad URL.
export function parseArtifactUrl(url: string): DocTarget | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${ARTIFACT_SCHEME}:` || !u.host || u.host === ASSETS_HOST) return null
    const path = u.pathname.slice(1).split('/').map(decodeURIComponent).join('/')
    if (!path) return null
    return { kind: 'file', projectId: u.host, path, hash: u.hash ? u.hash.slice(1) : null, fromDiff: null }
  } catch {
    return null
  }
}
