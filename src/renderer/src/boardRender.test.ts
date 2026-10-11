import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { unionFeatures } from './featureUnion'
import { repoGroups } from './repoGroups'
import { Board } from './components/Board'

// Rendered with react-dom/server: this repo runs vitest in node with no jsdom, and a board is a
// pure function of its props, so its markup is the whole of what it draws. Every component the
// board reaches is hook-free, so they can also be walked to reach a button's onClick.

const projects = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · fix-auth', path: '/src/wt', worktreeOf: 'p' },
] as Project[]

const stages = [{ id: 'questions', label: 'Questions' }, { id: 'design', label: 'Design' }]

const feature = (projectId: string, over: Partial<Feature> = {}): Feature => ({
  projectId, slug: 'f', path: '/src/' + projectId + '/f', title: 'Worktree support', kind: 'feature',
  group: false, parent: null, flow: null, stages: [], currentStage: 'questions', cardState: 'ready',
  progress: null, flags: [], warnings: [], artifacts: [], ...over,
})

const session = (projectId: string, label: string, slug: string | null = 'f'): Session =>
  ({ id: label, projectId, kind: 'claude', label, feature: slug, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z' } as Session)

const board = (features: Feature[], sessions: Session[] = [], onOpen = vi.fn()) =>
  createElement(Board, {
    stages,
    features: unionFeatures(features, repoGroups(projects)),
    sessions,
    projects,
    onOpen,
  })

const render = (features: Feature[], sessions: Session[] = []) => renderToStaticMarkup(board(features, sessions))

// The elements of a rendered tree, children first: a function component is called with its props,
// which is safe here because every one of them is a pure function of them.
type El = ReactElement<{ children?: ReactNode; [k: string]: unknown }>

function elements(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const el = node as El
  const type = el.type as unknown
  const kids = typeof type === 'function' ? elements(type(el.props) as ReactNode) : elements(el.props.children)
  return [el, ...kids]
}

const textsOf = (node: ReactNode): string[] => {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textsOf)
  return isValidElement(node) ? textsOf((node as El).props.children) : []
}

const buttons = (node: ReactNode) =>
  elements(node).filter((el) => el.type === 'button').map((el) => ({ el, label: textsOf(el.props.children).join('') }))

const countOf = (html: string, text: string) => html.split(text).length - 1

describe('Board', () => {
  it('draws one card per repo and slug, not one per checkout', () => {
    expect(countOf(render([feature('p'), feature('wt')]), 'Worktree support')).toBe(1)
  })

  it("keeps the card at the checkout's stage while a worktree copy sits at another", () => {
    const html = render([feature('p', { currentStage: 'questions' }), feature('wt', { currentStage: 'design' })])
    // the card sits in Questions with a count of 1, and Design holds none: the worktree's stage
    // did not move the card, it only put a chip on it
    expect(html).toMatch(/Questions <span[^>]*>1<\/span>/)
    expect(html).toMatch(/Design <span[^>]*>0<\/span>/)
  })

  it('draws a chip naming the checkout a worktree copy has moved on in', () => {
    const html = render([feature('p'), feature('wt', { currentStage: 'design' })])
    expect(html).toContain('also edited in grove · fix-auth')
  })

  it('draws no chip when the copies agree on the stage', () => {
    expect(render([feature('p'), feature('wt')])).not.toContain('also edited in')
  })

  it('draws no chip for a feature only a worktree has, however far along it is', () => {
    expect(render([feature('wt', { currentStage: 'design' })])).not.toContain('also edited in')
  })

  it('opens the worktree copy when its chip is clicked', () => {
    const onOpen = vi.fn()
    const [chip] = buttons(board([feature('p'), feature('wt', { currentStage: 'design' })], [], onOpen))
    expect(chip.label).toBe('also edited in grove · fix-auth')
    ;(chip.el.props.onClick as (e: unknown) => void)({ stopPropagation: () => {} })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toMatchObject({ projectId: 'wt', slug: 'f' })
  })

  it('opens the card itself when a card with a chip is clicked', () => {
    const onOpen = vi.fn()
    const card = elements(board([feature('p'), feature('wt', { currentStage: 'design' })], [], onOpen))
      .find((el) => typeof el.props.onClick === 'function' && el.props.className !== undefined && textsOf(el.props.children).includes('Worktree support'))
    ;(card!.props.onClick as () => void)()
    expect(onOpen.mock.calls[0][0]).toMatchObject({ projectId: 'p' })
  })

  it("puts a worktree session's dot on the repo's card", () => {
    const html = render([feature('p'), feature('wt')], [session('wt', 'fix-auth agent')])
    expect(countOf(html, 'Worktree support')).toBe(1)
    expect(html).toContain('fix-auth agent') // the linked session is drawn on that one card
  })

  it('draws a session linked in no checkout of the repo as no dot', () => {
    expect(render([feature('p')], [session('q', 'other repo', null)])).not.toContain('other repo')
  })
})