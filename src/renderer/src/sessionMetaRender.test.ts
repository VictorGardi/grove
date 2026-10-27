import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

describe('SessionMeta in a grid pane', () => {
  // a pane passes context and actions too; the chips sit in the one row between the status and them
  it('keeps every family chip in the single row, after the status and before the actions', () => {
    const grandparent = session('grandparent')
    const middle = session('middle', { parentId: 'grandparent', status: 'working' })
    const kid = session('kid', { parentId: 'middle', status: 'working' })
    const html = renderToStaticMarkup(createElement(SessionMeta, {
      lead: 'p / middle',
      session: middle,
      context: createElement('span', null, 'ctx'),
      actions: createElement('button', { 'aria-label': 'Open alone' }, '⤢'),
      family: { parent: grandparent, children: [kid], active: kid, onJump: () => {} },
    }))
    // one row: everything sits inside the single row div, which opens first. css modules name the
    // class `_row_<hash>`, so `\b` can't bound it (`_` is a word character); letters, digits and `-`
    // can't touch it either side, so a class like "arrow" doesn't count
    expect(html).toMatch(/^<div class="[^"]*(?<![a-zA-Z0-9-])row(?![a-zA-Z0-9-])[^"]*">/)
    expect(html.match(/class="[^"]*(?<![a-zA-Z0-9-])row(?![a-zA-Z0-9-])[^"]*"/g)).toHaveLength(1)

    const status = html.indexOf('>working<')
    const up = html.indexOf('aria-label="Jump to parent grandparent"')
    const down = html.indexOf('aria-label="Jump to child kid"')
    const count = html.indexOf('>1 child</button>')
    const open = html.indexOf('aria-label="Open alone"')
    for (const i of [status, up, down, count, open]) expect(i).toBeGreaterThan(-1)
    expect(status).toBeLessThan(up)
    expect(up).toBeLessThan(down)
    expect(down).toBeLessThan(count)
    expect(count).toBeLessThan(open)
  })
})

describe('SessionMeta stacked, in the content header', () => {
  const stacked = (over: Partial<Session> = {}) => renderToStaticMarkup(createElement(SessionMeta, {
    lead: 'slice-3', trail: createElement('span', null, 'project › feature'),
    session: session('slice-3', { branch: 'feature/long-branch', status: 'idle', ...over }),
  }))

  it('names the session and its status on the first line, the trail and branch on the second', () => {
    const html = stacked()
    const [lead, status, trail, branch] = ['>slice-3<', '>idle<', '>project › feature<', '>feature/long-branch<'].map((x) => html.indexOf(x))
    for (const i of [lead, status, trail, branch]) expect(i).toBeGreaterThan(-1)
    expect(lead).toBeLessThan(status)
    expect(status).toBeLessThan(trail)
    expect(trail).toBeLessThan(branch)
    expect(html.match(/class="[^"]*(?<![a-zA-Z0-9-])line(?![a-zA-Z0-9-])[^"]*"/g)).toHaveLength(2)
  })

  it("colours a worktree's branch and names the worktree in its title", () => {
    const branch = (html: string) => html.match(/<span class="([^"]*)" title="([^"]*)">feature\/long-branch</)
    expect(branch(stacked())?.[1]).not.toMatch(/(?<![a-zA-Z0-9-])worktree(?![a-zA-Z0-9-])/)
    const html = renderToStaticMarkup(createElement(SessionMeta, {
      lead: 'slice-3', session: session('slice-3', { branch: 'feature/long-branch' }),
      worktree: { id: 'w', name: 'p · wt', path: '/wt', worktreeOf: 'p' },
    }))
    expect(branch(html)?.[1]).toMatch(/(?<![a-zA-Z0-9-])worktree(?![a-zA-Z0-9-])/)
    expect(branch(html)?.[2]).toContain('Worktree: /wt')
  })

  it('draws one line without a trail, as a grid pane does', () => {
    const html = renderToStaticMarkup(createElement(SessionMeta, { lead: 'p / slice-3', session: session('slice-3', { branch: 'b' }) }))
    expect(html).not.toMatch(/(?<![a-zA-Z0-9-])line(?![a-zA-Z0-9-])/)
  })
})

describe('SessionMeta row CSS', () => {
  const css = readFileSync(fileURLToPath(new URL('./components/SessionMeta.module.css', import.meta.url)), 'utf8')
  // the body of the first rule whose selector is exactly `selector`
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
    if (!m) throw new Error(`no rule ${selector}`)
    return m[1]
  }
  // flex-shrink from a `flex: <grow> <shrink> <basis>` shorthand, or a `flex-shrink: N` longhand
  const shrink = (selector: string) => {
    const body = rule(selector)
    const m = body.match(/(?:^|[;\s])flex:\s*\d+\s+(\d+)/) ?? body.match(/flex-shrink:\s*(\d+)/)
    if (!m) throw new Error(`no flex shrink in ${selector}`)
    return Number(m[1])
  }

  it('keeps the row to one line', () => {
    expect(css).not.toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.status')).toMatch(/(?:^|[;\s])flex:\s*none/)
    expect(rule('.lead')).toMatch(/min-width:\s*6ch/)
    // the pane clips the row, so the row must not: its buttons' focus rings would be cut off
    expect(rule('.row')).not.toMatch(/overflow:\s*hidden/)
  })

  it('lets the chips shrink before the branch and the lead', () => {
    expect(shrink('.chip')).toBeGreaterThan(shrink('.branch'))
    expect(shrink('.chip')).toBeGreaterThan(shrink('.lead'))
  })
})
