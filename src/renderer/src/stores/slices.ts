import { create } from 'zustand'
import type { Project, Session, UiState } from '@shared/types'
import { DEFAULT_UI } from '@shared/types'

interface SlicesState {
  projects: Project[]
  sessions: Session[]
  ui: UiState
  errors: string[]
  hydrate(): Promise<void>
  setFocused(id: string | null): void
}

export const useSlices = create<SlicesState>((set) => ({
  projects: [],
  sessions: [],
  ui: DEFAULT_UI,
  errors: [],
  async hydrate() {
    const { api } = window
    // subscribe first so a push between the two can't be lost
    api.on('state:projects', (projects) => set({ projects }))
    api.on('state:sessions', (sessions) => set({ sessions }))
    api.on('state:ui', (ui) => set({ ui }))
    const [slices, errors] = await Promise.all([api.invoke('state:get'), api.invoke('app:errors')])
    if (slices.ok) set(slices.data)
    if (errors.ok) set({ errors: errors.data })
  },
  setFocused: (id) => { void window.api.invoke('ui:set', { focusedSessionId: id }) },
}))
