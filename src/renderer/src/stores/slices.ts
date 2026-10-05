import { create } from 'zustand'
import type { FeaturesSlice, Project, Session, UiState } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES } from '@shared/types'

interface SlicesState {
  projects: Project[]
  sessions: Session[]
  ui: UiState
  features: FeaturesSlice
  errors: string[]
  hydrate(): Promise<void>
  setFocused(id: string | null): void
  toggleCollapsed(key: string): void
}

export const useSlices = create<SlicesState>((set, get) => ({
  projects: [],
  sessions: [],
  ui: DEFAULT_UI,
  features: EMPTY_FEATURES,
  errors: [],
  async hydrate() {
    const { api } = window
    // subscribe first so a push between the two can't be lost
    api.on('state:projects', (projects) => set({ projects }))
    api.on('state:sessions', (sessions) => set({ sessions }))
    api.on('state:ui', (ui) => set({ ui }))
    api.on('state:features', (features) => set({ features }))
    const [slices, errors] = await Promise.all([api.invoke('state:get'), api.invoke('app:errors')])
    if (slices.ok) set(slices.data)
    if (errors.ok) set({ errors: errors.data })
  },
  setFocused: (id) => { void window.api.invoke('ui:set', { focusedSessionId: id }) },
  toggleCollapsed(key) {
    const { collapsed } = get().ui
    const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]
    void window.api.invoke('ui:set', { collapsed: next })
  },
}))
