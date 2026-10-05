import { ARTIFACT_SCHEME, ASSETS_HOST } from '@shared/artifactUrl'

const asset = (file: string) => `${ARTIFACT_SCHEME}://${ASSETS_HOST}/${file}`

// Bundled Mermaid plus our init; the page's own inline init is blocked by the CSP.
export const MERMAID_SCRIPTS = `<script src="${asset('mermaid.min.js')}"></script><script src="${asset('mermaid-init.js')}"></script>`

// grove-render's CDN Mermaid tag → the bundled copy, so diagrams render offline.
export function rewriteHtml(html: string): string {
  return html.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@[^"]*"\s*><\/script>/g, MERMAID_SCRIPTS)
}
