import { describe, expect, it, vi } from 'vitest'
import { createFocusSignal } from './focus-signal.ts'
import { memoryViewState } from './view-state.ts'
import { createWindowStore } from './window-store.ts'

describe('signalling an active-tab change', () => {
  it('signals the first focus, then only a change of Active tab or Active space', () => {
    const emit = vi.fn()
    const signal = createFocusSignal(emit)
    signal('a', 'a1')
    signal('a', 'a1')
    expect(emit).toHaveBeenCalledTimes(1)
    signal('a', 'a2')
    signal('b', 'a2')
    signal('b', null)
    expect(emit).toHaveBeenCalledTimes(4)
  })

  it('does not signal for a status or context change', () => {
    const emit = vi.fn()
    const signal = createFocusSignal(emit)
    const store = createWindowStore({ changed: () => signal(store.activeSpace, store.activeTab?.id ?? null), viewState: memoryViewState() })
    store.upsertSpace({ id: 'a', path: '/work/a', name: 'a', label: null, repoName: null, parent: null, worktree: false, branch: null })
    store.addTab({ id: 'a1', spaceId: 'a', spacePath: '/work/a', kind: 'terminal', label: null, alive: true, exitCode: null })
    store.activateTab('a1')
    emit.mockClear()
    store.applyStatusChange({ tabId: 'a1', agent: 'claude', state: 'working', since: 1, source: 'claude' })
    store.applyContext('a1', { tokens: 10, window: null, percent: null, model: null, at: 1 })
    store.applyStatusChange({ tabId: 'a1', agent: 'claude', state: 'idle', since: 2, source: 'claude' })
    expect(emit).not.toHaveBeenCalled()
    store.addTab({ id: 'a2', spaceId: 'a', spacePath: '/work/a', kind: 'terminal', label: null, alive: true, exitCode: null })
    store.activateTab('a2')
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
