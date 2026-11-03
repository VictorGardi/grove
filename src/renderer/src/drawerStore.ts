import { useSyncExternalStore } from 'react'
import { toggledDrawer } from './childDrawer'

// The parent whose children drawer is open, or null. One value for the whole window, so the
// sidebar bar and the header chip open the very same drawer and at most one exists.
let open: string | null = null
const listeners = new Set<() => void>()
const set = (next: string | null) => { if (next !== open) { open = next; listeners.forEach((l) => l()) } }

export const toggleDrawer = (parentId: string) => set(toggledDrawer(open, parentId))
export const closeDrawer = () => set(null)
export const useDrawerFor = (): string | null =>
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => open, () => null)
