import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Comment, Project, Session } from '@shared/types'
import { FeatureReviewPanel } from './components/ReviewTray'

// The full page's Comments popover body, rendered with react-dom/server (the popover itself starts closed).

const projects = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · a', path: '/src/wt', worktreeOf: 'p' },
] as Project[]
const feature = { projectId: 'p', slug: 'f' }

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, projectId: 'p', kind: 'claude', label: id, feature: 'f', lastStatus: 'running', agentSessionId: null,
  startedAt: '2026-10-01T10:00:00.000Z', lastFocusedAt: null, ...over,
} as Session)

const draft = { id: 'c1', sessionId: null, feature, anchor: { kind: 'file', projectId: 'p', path: 'docs/work/f/03-design.md', exact: 'quote' }, body: 'fix this', state: 'draft', sentAt: null } as unknown as Comment

const panel = (sessions: Session[], drafts: Comment[] = [draft]) =>
  renderToStaticMarkup(createElement(FeatureReviewPanel, { feature, drafts, sessions, projects, onJump: vi.fn() }))

describe('the full page Comments tray', () => {
  it('sends to the one linked session, named and not switchable', () => {
    const html = panel([session('Design review')])
    expect(html).toMatch(/<div[^>]*>Sending to: <span[^>]*>Design review<\/span><\/div>/)
    expect(html).not.toContain('aria-haspopup')
    expect(html).toMatch(/<button[^>]*>Send<\/button>/)
  })

  it('offers to switch between several, defaulting to the most recently focused', () => {
    const html = panel([session('older'), session('newer', { lastFocusedAt: '2026-10-05T10:00:00.000Z' })])
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>Sending to: <span[^>]*>newer<\/span>/)
    expect(html).toMatch(/<button[^>]*>Send<\/button>/)
  })

  it("starts a session with the repo's usual agent when none is linked", () => {
    const html = panel([session('shell', { kind: 'terminal' }), session('other', { feature: null, kind: 'opencode' })])
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>Sending to: <span[^>]*>new OpenCode session<\/span>/)
    expect(html).toMatch(/<button[^>]*>Start a session and send<\/button>/)
  })

  it('disables Send with no drafts', () => {
    expect(panel([session('a')], [])).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/)
  })
})
