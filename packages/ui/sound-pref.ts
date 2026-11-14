import { flagPref, type KeyValueStore } from './persisted-pref.ts'

// Whether alerts play a sound, kept in the window's storage so a reload keeps it. Off until the human turns it on; the system
// notification shows either way.

export const SOUND_KEY = 'grove.sound'

const sound = flagPref(SOUND_KEY, 'on', 'off')

export const readSound = (store: KeyValueStore | null): boolean => sound.read(store)
export const writeSound = (store: KeyValueStore | null, on: boolean): void => sound.write(store, on)
