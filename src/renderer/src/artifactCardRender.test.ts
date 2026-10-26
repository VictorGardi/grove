import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactCard } from './components/ArtifactCard'
import type { ArtifactCard as Card } from './artifactsBoard'

// Rendered with react-dom/server, like the project page: what a card mounts, live or not.

const card = (path: string, mtimeMs = 42): Card => ({ name: path.split('/').pop()!, path, stage: 'design', mtimeMs })
const render = (c: Card, live: boolean) => renderToStaticMarkup(createElement(ArtifactCard, {
  id: 'c', projectId: 'p', card: c, stage: 'Design', live, now: 42 + 5 * 60_000, onOpen: vi.fn(), register: vi.fn(),
}))

describe('ArtifactCard', () => {
  it('mounts a live page as a sandboxed frame inside the inert preview', () => {
    const html = render(card('docs/f/03-design.html'), true)
    expect(html).toMatch(/<span[^>]*inert=""[^>]*><iframe[^>]*sandbox="allow-scripts"/)
    expect(html).toContain('src="grove-artifact://p/docs/f/03-design.html"')
    expect(html).not.toContain('<img')
    expect(html).toContain('5m ago')
  })

  it('draws a live image as an <img> whose src carries the mtime', () => {
    const html = render(card('docs/f/shot.png'), true)
    expect(html).toMatch(/<span[^>]*inert=""[^>]*><img[^>]*src="grove-artifact:\/\/p\/docs\/f\/shot\.png\?v=42"/)
    expect(html).not.toContain('<iframe')
  })

  it('shows only the title when not live', () => {
    for (const [path, name] of [['docs/f/03-design.html', '03-design\\.html'], ['docs/f/shot.png', 'shot\\.png']]) {
      const html = render(card(path), false)
      expect(html).toMatch(new RegExp(`inert=""[^>]*><span[^>]*>${name}</span></span>`))
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('<img')
    }
  })
})
