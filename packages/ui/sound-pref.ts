import type { KeyValueStore } from './sidebar-state.ts'

// Whether alerts play a sound, kept in the window's storage so a reload keeps it. Off until the human turns it on; the system
// notification shows either way.

export const SOUND_KEY = 'grove-next.sound'

export function readSound(store: KeyValueStore | null): boolean {
  try {
    return store?.getItem(SOUND_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeSound(store: KeyValueStore | null, on: boolean): void {
  try {
    store?.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // not kept: the switch still holds for this run
  }
}
