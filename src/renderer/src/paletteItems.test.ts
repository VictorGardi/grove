import { describe, expect, it, vi } from 'vitest'
import type { Feature, Project, Session } from '@shared/types'
import { newSessionItems, PALETTE_COMMANDS, paletteItems, rank } from './paletteItems'

const projects = [{ id: 'p1', name: 'grove', path: '/g' }, { id: 'p2', name: 'other', path: '/o' }] as Project[]
const session = (id: string, label: string, extra: Partial<Session> = {}) =>
  ({ id, projectId: 'p1', kind: 'claude', label, lastStatus: 'running', ...extra }) as Session
const sessions = [session('s1', 'fix sidebar'), session('s2', 'write docs', { status: 'waiting' }), session('s3', 'terminal', { kind: 'terminal' })]
const features = [
  { projectId: 'p1', slug: 'grid', title: 'Session grid', stages: [], currentStage: null, cardState: 'done', progress: null },
] as unknown as Feature[]

const actions = () => ({ focusSession: vi.fn(), focusFeature: vi.fn(), openProject: vi.fn(), runAction: vi.fn() })
const items = (a = actions()) => paletteItems({ projects, sessions, features }, a)

describe('paletteItems', () => {
  it('lists sessions, features and projects with kind, label and detail', () => {
    const all = items()
    expect(all.map((i) => i.kind)).toEqual(['session', 'session', 'session', 'feature', 'project', 'project', ...PALETTE_COMMANDS.map(() => 'command')])
    expect(all[0]).toMatchObject({ label: 'fix sidebar', detail: 'grove · claude · running' })
    expect(all[1].waiting).toBe(true)
    expect(all[3]).toMatchObject({ label: 'Session grid', detail: 'grove · Done' })
  })

  it('orders sessions by last focus, newest first; never-focused keep list order', () => {
    const list = [session('a', 'a'), session('b', 'b', { lastFocusedAt: '2026-10-08T10:00:00Z' }), session('c', 'c', { lastFocusedAt: '2026-10-08T11:00:00Z' }), session('d', 'd')]
    const labels = paletteItems({ projects, sessions: list, features: [] }, actions()).filter((i) => i.kind === 'session').map((i) => i.label)
    expect(labels).toEqual(['c', 'b', 'a', 'd'])
  })

  it('lists the app commands, which run through runAction', () => {
    const a = actions()
    const cmds = paletteItems({ projects, sessions, features }, a).filter((i) => i.kind === 'command')
    expect(cmds.map((c) => c.label)).toEqual(['New session', 'New terminal', 'Remove session', 'Session diff', 'Project board', 'Toggle sidebar', 'Last session', 'Show grid', 'Add session to grid and show', 'Clear grid'])
    cmds[1].run()
    expect(a.runAction).toHaveBeenCalledWith({ type: 'newTerminal' })
  })

  it('shows grid membership and flips Show grid to Hide grid', () => {
    const on = paletteItems({ projects, sessions, features, grid: { open: true, members: ['s2'] }, gridShown: true }, actions())
    expect(on.find((i) => i.id === 'session:s2')?.detail).toContain('in grid')
    expect(on.find((i) => i.id === 'session:s1')?.detail).not.toContain('in grid')
    expect(on.some((i) => i.label === 'Hide grid')).toBe(true)
    expect(items().some((i) => i.label === 'Show grid')).toBe(true)
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
    expect(rank(items(), '').map((r) => r.item.label)).toEqual(['write docs', 'fix sidebar', 'terminal', 'Session grid', 'grove', 'other', ...PALETTE_COMMANDS.map((c) => c.label)])
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

  it('ranks a command by its label', () => {
    expect(rank(items(), 'new term')[0].item.label).toBe('New terminal')
  })

  it('returns nothing when nothing matches', () => {
    expect(rank(items(), 'zzz')).toEqual([])
  })
})

describe('newSessionItems', () => {
  it('lists the current project first, and "c" picks Claude Code there', () => {
    const create = vi.fn()
    const list = newSessionItems(projects, 'p2', create)
    expect(list.map((i) => i.label).slice(0, 4)).toEqual(['OpenCode · other', 'Claude Code · other', 'Terminal · other', 'OpenCode · grove'])
    expect(list).toHaveLength(6)
    rank(list, 'c')[0].item.run()
    expect(create).toHaveBeenCalledWith('p2', 'claude')
  })

  it('reaches another project by typing its name', () => {
    const create = vi.fn()
    rank(newSessionItems(projects, 'p2', create), 'claude gro')[0].item.run()
    expect(create).toHaveBeenCalledWith('p1', 'claude')
  })

  it('keeps plain labels with a single project', () => {
    expect(newSessionItems([projects[0]], 'p1', vi.fn()).map((i) => i.label)).toEqual(['OpenCode', 'Claude Code', 'Terminal'])
  })
})
