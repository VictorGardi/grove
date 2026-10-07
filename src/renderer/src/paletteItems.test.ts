import { describe, expect, it, vi } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { paletteItems, rank } from './paletteItems'

const projects = [{ id: 'p1', name: 'grove', path: '/g' }, { id: 'p2', name: 'other', path: '/o' }] as Project[]
const session = (id: string, label: string, extra: Partial<Session> = {}) =>
  ({ id, projectId: 'p1', kind: 'claude', label, lastStatus: 'running', ...extra }) as Session
const sessions = [session('s1', 'fix sidebar'), session('s2', 'write docs', { status: 'waiting' }), session('s3', 'terminal', { kind: 'terminal' })]
const features = [
  { projectId: 'p1', slug: 'grid', title: 'Session grid', stages: [], currentStage: null, cardState: 'done', progress: null },
] as unknown as Feature[]

const actions = () => ({ focusSession: vi.fn(), focusFeature: vi.fn(), openProject: vi.fn() })
const items = (a = actions()) => paletteItems({ projects, sessions, features }, a)

describe('paletteItems', () => {
  it('lists sessions, features and projects with kind, label and detail', () => {
    const all = items()
    expect(all.map((i) => i.kind)).toEqual(['session', 'session', 'session', 'feature', 'project', 'project'])
    expect(all[0]).toMatchObject({ label: 'fix sidebar', detail: 'grove · claude · running' })
    expect(all[1].waiting).toBe(true)
    expect(all[3]).toMatchObject({ label: 'Session grid', detail: 'grove · Done' })
  })

  it('runs the matching action for each kind', () => {
    const a = actions()
    const all = items(a)
    all[0].run()
    all[3].run()
    all[5].run()
    expect(a.focusSession).toHaveBeenCalledWith('s1')
    expect(a.focusFeature).toHaveBeenCalledWith({ projectId: 'p1', slug: 'grid' })
    expect(a.openProject).toHaveBeenCalledWith('p2')
  })
})

describe('rank', () => {
  it('lists everything for an empty query: waiting sessions first, then kind order', () => {
    expect(rank(items(), '').map((r) => r.item.label)).toEqual(['write docs', 'fix sidebar', 'terminal', 'Session grid', 'grove', 'other'])
  })

  it('filters by subsequence and ranks by score', () => {
    const out = rank(items(), 'gri')
    expect(out[0].item.label).toBe('Session grid') // label matches outrank detail-only matches
    expect(out[0].indices).toEqual([8, 9, 10])
  })

  it('breaks score ties by kind order', () => {
    const tie = paletteItems({
      projects: [{ id: 'p3', name: 'docs', path: '/d' }],
      sessions: [session('s9', 'docs')],
      features: [],
    }, actions())
    expect(rank(tie, 'docs').map((r) => r.item.kind)).toEqual(['session', 'project'])
  })

  it('falls back to the detail, below label matches', () => {
    const out = rank(items(), 'other')
    expect(out.map((r) => r.item.label)).toEqual(['other'])
    const byProject = rank(items(), 'grove')
    expect(byProject[0].item.label).toBe('grove')
    expect(byProject.length).toBeGreaterThan(1)
    expect(byProject[1].indices).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(rank(items(), 'zzz')).toEqual([])
  })
})
