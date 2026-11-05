// The tabs of one space, most recently visited first, as plain functions so they run in tests. Previous-tab goes back through them.

// The list with the tab moved to the front: the tab just visited is the most recent.
export function visited<T>(recent: T[], tab: T): T[] {
  return [tab, ...recent.filter((other) => other !== tab)]
}

// The tab to go back to: the most recent one that is not the current tab. Undefined when there is none. Visiting it again moves the
// current tab back to the front, so pressing the key again returns to the first.
export function previousOf<T>(recent: T[], current: T | null): T | undefined {
  return recent.find((tab) => tab !== current)
}
