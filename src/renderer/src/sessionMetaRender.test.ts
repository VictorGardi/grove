import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { SessionMeta } from './components/SessionMeta'

// Rendered with react-dom/server: vitest runs in node with no jsdom, and the row is a pure
// function of its props.

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'p', kind: 'claude', label: id, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z', ...over } as Session)

const parent = session('parent')
const child = session('fix-the-login-flow', { parentId: 'parent', status: 'working' })

type Family = { parent: Session | null; children: Session[]; active: Session | null; onJump: (id: string) => void }
const render = (family?: Family, self: Session = parent) =>
  renderToStaticMarkup(createElement(SessionMeta, { lead: 'lead', session: self, family }))

describe('SessionMeta family chip', () => {
  it('shows the active child as a button with its label', () => {
    const html = render({ parent: null, children: [child], active: child, onJump: () => {} })
    expect(html).toContain('aria-label="Jump to child fix-the-login-flow"')
    expect(html).toMatch(/<button type="button"[^>]*>.*fix-the-login-flow.*<\/button>/)
    expect(html).toContain('title="fix-the-login-flow · working"')
  })

  it('shows no chip without a family or an active child', () => {
    for (const html of [render(), render({ parent: null, children: [], active: null, onJump: () => {} })]) {
      expect(html).not.toContain('Jump to child')
      expect(html).not.toContain('<button')
    }
  })
})

describe('SessionMeta parent chip', () => {
  it('shows the parent as a button with an up arrow and its label', () => {
    const html = render({ parent, children: [], active: null, onJump: () => {} }, child)
    expect(html).toContain('aria-label="Jump to parent parent"')
    expect(html).toMatch(/<button type="button"[^>]*>.*↑.*parent.*<\/button>/)
    expect(html).toContain('title="parent · ')
  })

  it('still shows an ended parent', () => {
    const html = render({ parent: session('parent', { lastStatus: 'gone' }), children: [], active: null, onJump: () => {} }, child)
    expect(html).toContain('aria-label="Jump to parent parent"')
  })

  it('shows no up chip without a parent', () => {
    const html = render({ parent: null, children: [], active: null, onJump: () => {} }, child)
    expect(html).not.toContain('Jump to parent')
    expect(html).not.toContain('↑')
  })
})

describe('SessionMeta children chip', () => {
  const kid = (id: string, over: Partial<Session> = {}) => session(id, { parentId: 'parent', ...over })

  it('counts one child and three children', () => {
    expect(render({ parent: null, children: [child], active: child, onJump: () => {} })).toContain('>1 child</button>')
    const three = [child, kid('b', { status: 'idle' }), kid('c', { status: 'idle' })]
    expect(render({ parent: null, children: three, active: child, onJump: () => {} })).toContain('>3 children</button>')
  })

  it('keeps the list closed until clicked', () => {
    const html = render({ parent: null, children: [child], active: child, onJump: () => {} })
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-label="Children"')
  })

  it('still counts children that have all ended, with no child chip', () => {
    const ended = [kid('a', { lastStatus: 'gone' }), kid('b', { lastStatus: 'gone' })]
    const html = render({ parent: null, children: ended, active: null, onJump: () => {} })
    expect(html).toContain('>2 children</button>')
    expect(html).not.toContain('Jump to child')
  })

  it('shows no count without children', () => {
    const html = render({ parent: null, children: [], active: null, onJump: () => {} })
    expect(html).not.toMatch(/\d+ child/)
  })
})
