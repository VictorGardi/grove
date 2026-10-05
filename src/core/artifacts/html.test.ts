import { describe, expect, it } from 'vitest'
import { rewriteHtml } from './html'

const bundled = '<script src="grove-artifact://assets/mermaid.min.js"></script><script src="grove-artifact://assets/mermaid-init.js"></script>'

describe('rewriteHtml', () => {
  it.each(['mermaid@11', 'mermaid@12.1.0'])('swaps the %s CDN tag for the bundled scripts', (pkg) => {
    const out = rewriteHtml(`<head><script src="https://cdn.jsdelivr.net/npm/${pkg}/dist/mermaid.min.js"></script></head>`)
    expect(out).toContain(bundled)
    expect(out).not.toContain('cdn.jsdelivr.net')
  })

  it('leaves a page without the tag unchanged', () => {
    const page = '<html><body><p>no diagrams</p></body></html>'
    expect(rewriteHtml(page)).toBe(page)
  })
})
