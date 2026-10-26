import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ArtifactRef, CanvasView, Feature, Project, Session, UiState } from '@shared/types'
import { modifiedAgo } from './artifactsBoard'
import { ProjectPage } from './components/ProjectPage'

// Rendered with react-dom/server: no jsdom here, and the page is a pure function of its props.

const projects = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · fix-auth', path: '/src/wt', worktreeOf: 'p' },
] as Project[]

const stages = [{ id: 'questions', label: 'Questions' }, { id: 'design', label: 'Design' }]

const feature = (projectId: string, over: Partial<Feature> = {}): Feature => ({
  projectId, slug: 'f', path: '/src/' + projectId + '/f', title: 'Worktree support', kind: 'feature',
  group: false, parent: null, flow: null, stages: stages.map((st) => ({ ...st, artifact: st.id + '.md', review: null, state: 'upcoming' as const })), currentStage: 'questions', cardState: 'ready',
  progress: null, flags: [], warnings: [], artifacts: [], ...over,
})

const session = (id: string, projectId: string, label = id): Session =>
  ({ id, projectId, kind: 'terminal', label, feature: null, lastStatus: 'running', startedAt: '2026-10-05T10:00:00.000Z' } as Session)

const page = (project: Project, board: UiState['board'], features: Feature[], sessions: Session[], artifactsOpen: ArtifactRef | null = null, artifactsView?: CanvasView, artifactsFilter: string | null = null) =>
  renderToStaticMarkup(createElement(ProjectPage, {
    project, projects, board, stages, features, sessions, artifactsOpen, artifactsView, artifactsFilter,
    onOpenFeature: vi.fn(), onFocusSession: vi.fn(), onOpenArtifact: vi.fn(), onArtifactsViewChange: vi.fn(), onArtifactsFilterChange: vi.fn(),
  }))

const sessionsPage = (project: Project, features: Feature[], sessions: Session[]) => page(project, 'sessions', features, sessions)

describe('ProjectPage, the checkout\'s', () => {
  const features = [feature('p'), feature('wt')]

  it('draws one card for a feature both checkouts hold', () => {
    expect(page(projects[0], 'features', features, []).split('Worktree support').length - 1).toBe(1)
  })

  it("lists the worktree's sessions on its Sessions board", () => {
    const html = sessionsPage(projects[0], features, [session('a', 'p', 'in the checkout'), session('b', 'wt', 'in the worktree')])
    expect(html).toContain('in the checkout')
    expect(html).toContain('in the worktree')
  })
})

describe('ProjectPage, a worktree\'s', () => {
  const features = [feature('p'), feature('wt')]
  const sessions = [session('a', 'p', 'in the checkout'), session('b', 'wt', 'in the worktree')]

  it('shows sessions and no board, whatever the switch says', () => {
    const html = page(projects[1], 'features', features, sessions)
    expect(html).not.toContain('Worktree support')
    expect(html).not.toContain('Questions') // the Features board's stage columns
    expect(html).toContain('Waiting')
  })

  it('shows its own sessions and not the checkout\'s', () => {
    const html = sessionsPage(projects[1], features, sessions)
    expect(html).toContain('in the worktree')
    expect(html).not.toContain('in the checkout')
  })
})

describe('ProjectPage, the artifacts board', () => {
  const art = (name: string, stage: string | null, role: 'artifact' | 'review' | null = 'artifact') => ({ name, stage, role, mtimeMs: 1 })
  const features = [feature('p', { path: '/src/p/docs/work/f', artifacts: [art('01-questions.md', 'questions'), art('03-design.md', 'design'), art('03-design.html', 'design', 'review')] })]
  const ref = { projectId: 'p', slug: 'f', name: '03-design.md' }

  it('lists each feature as a titled cluster of artifact cards', () => {
    const html = page(projects[0], 'artifacts', features, [])
    expect(html).toContain('Worktree support')
    expect(html).toContain('01-questions.md')
    expect(html).toContain('03-design.md')
    expect(html).not.toContain('03-design.html') // folded into its markdown's card
    expect(html).not.toContain('<iframe')
  })

  it("dates each card, and mounts no preview before it has measured where the cards are", () => {
    const html = page(projects[0], 'artifacts', features, [])
    const when = modifiedAgo(1, Date.now()) // mtime 1: long ago, a short date
    expect(html.split(`>${when}</span>`)).toHaveLength(3)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<img')
  })

  it('draws the board at its saved pan and zoom, or the default view without one', () => {
    expect(page(projects[0], 'artifacts', features, [], null, { x: 120, y: -40, scale: 0.5 })).toContain('style="--x:120px;--y:-40px;--scale:0.5"')
    const html = page(projects[0], 'artifacts', features, [])
    expect(html).toContain('style="--x:0px;--y:0px;--scale:1"')
    expect(html).toContain('100%')
  })

  it('shows the open artifact full page in place of the board', () => {
    const html = page(projects[0], 'artifacts', features, [], ref)
    expect(html).toContain('<iframe')
    expect(html).toContain('src="grove-artifact://p/docs/work/f/03-design.html"')
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('← Back')
    expect(html).not.toContain('01-questions.md')
  })

  it('offers the feature\'s comments, and the markdown behind an html face to comment on', () => {
    const html = page(projects[0], 'artifacts', features, [], ref)
    expect(html).toContain('Comments (0)')
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Markdown<\/button>/)
  })

  it('offers no Markdown toggle on a card that is its own markdown', () => {
    const html = page(projects[0], 'artifacts', features, [], { ...ref, name: '01-questions.md' })
    expect(html).toContain('Comments (0)')
    expect(html).not.toContain('>Markdown<')
    expect(html).toContain('src="grove-artifact://p/docs/work/f/01-questions.md"')
  })

  it('falls back to the board when the open artifact is gone', () => {
    const html = page(projects[0], 'artifacts', features, [], { ...ref, name: 'gone.md' })
    expect(html).not.toContain('<iframe')
    expect(html).toContain('01-questions.md')
  })

  describe('filtered, and stepped through', () => {
    const other = feature('p', { slug: 'g', title: 'Session notes', path: '/src/p/docs/work/g', artifacts: [art('00-ticket.md', 'questions')] })
    const two = [...features, other]

    it('draws only the filtered feature, with every feature in the picker', () => {
      const html = page(projects[0], 'artifacts', two, [], null, undefined, 'g')
      expect(html).toContain('00-ticket.md')
      expect(html).not.toContain('01-questions.md')
      expect(html).toContain('aria-label="Feature"')
      expect(html).toContain('<option value="">All features</option>')
      expect(html).toContain('<option value="f">Worktree support</option>')
      expect(html).toContain('<option value="g" selected="">Session notes</option>')
      expect(html).toContain('aria-label="Clear filter"')
    })

    it('draws every feature without a filter, and offers no clear', () => {
      const html = page(projects[0], 'artifacts', two, [])
      expect(html).toContain('00-ticket.md')
      expect(html).toContain('01-questions.md')
      expect(html).not.toContain('aria-label="Clear filter"')
    })

    it('steps from the first card: no previous, a next, and its place on the board', () => {
      const html = page(projects[0], 'artifacts', two, [], { ...ref, name: '01-questions.md' })
      expect(html).toMatch(/<button[^>]*aria-label="Previous artifact"[^>]*disabled=""/)
      expect(html).not.toMatch(/<button[^>]*aria-label="Next artifact"[^>]*disabled=""/)
      expect(html).toContain('1 of 3')
    })

    it('counts only the filtered feature\'s cards on the full page', () => {
      const html = page(projects[0], 'artifacts', two, [], ref, undefined, 'f')
      expect(html).toContain('2 of 2')
      expect(html).toMatch(/<button[^>]*aria-label="Next artifact"[^>]*disabled=""/)
    })
  })

  it("still shows a worktree page's sessions", () => {
    const html = page(projects[1], 'artifacts', features, [session('b', 'wt', 'in the worktree')], ref)
    expect(html).toContain('in the worktree')
    expect(html).not.toContain('<iframe')
  })
})
