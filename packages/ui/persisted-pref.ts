// How a preference is kept in the window's storage so a reload keeps it: one key, one default, and the failure handling every
// preference shares. The storage may be missing or throw (a private window, blocked site data); then the default stands and a change
// is not kept, while the caller's own value still holds for this run. A preference adds only what is its own: how its text is read
// back as a valid value, and how a value is written as text.

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PersistedPref<T> {
  read(store: KeyValueStore | null): T
  write(store: KeyValueStore | null, value: T): void
}

export interface PersistedPrefSpec<T> {
  key: string
  // A function so a default that is an object is fresh on every read.
  fallback: () => T
  // The value the stored text stands for, or undefined when it is not a valid one (the default stands). It may throw for text that
  // should not be there at all, which `onFailure` hears about.
  decode: (text: string) => T | undefined
  encode: (value: T) => string
  // Told when reading or writing fails; silent when left out.
  onFailure?: (action: 'read' | 'write', error: unknown) => void
}

export function persistedPref<T>(spec: PersistedPrefSpec<T>): PersistedPref<T> {
  return {
    read(store) {
      try {
        const text = store?.getItem(spec.key)
        if (text === null || text === undefined) return spec.fallback()
        return spec.decode(text) ?? spec.fallback()
      } catch (error) {
        spec.onFailure?.('read', error)
        return spec.fallback()
      }
    },
    write(store, value) {
      try {
        store?.setItem(spec.key, spec.encode(value))
      } catch (error) {
        spec.onFailure?.('write', error)
      }
    },
  }
}

// A switch kept as two words, e.g. 'on' and 'off'. Anything else stored reads as off.
export function flagPref(key: string, on: string, off: string): PersistedPref<boolean> {
  return persistedPref({ key, fallback: () => false, decode: (text) => text === on, encode: (value) => (value ? on : off) })
}
