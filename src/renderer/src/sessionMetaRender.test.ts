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

const render = (family?: { active: Session | null; onJump: (id: string) => void }) =>
  renderToStaticMarkup(createElement(SessionMeta, { lead: 'lead', session: parent, family }))

describe('SessionMeta family chip', () => {
  it('shows the active child as a button with its label', () => {
    const html = render({ active: child, onJump: () => {} })
    expect(html).toContain('aria-label="Jump to child fix-the-login-flow"')
    expect(html).toMatch(/<button type="button"[^>]*>.*fix-the-login-flow.*<\/button>/)
    expect(html).toContain('title="fix-the-login-flow · working"')
  })

  it('shows no chip without a family or an active child', () => {
    for (const html of [render(), render({ active: null, onJump: () => {} })]) {
      expect(html).not.toContain('Jump to child')
      expect(html).not.toContain('<button')
    }
  })
})
