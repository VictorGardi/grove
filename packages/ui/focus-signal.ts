// Tells the modules when the tab on screen changed. The window repaints on every store write, a status or context tick
// included, but the diff panel only retargets when the Active tab or Active space is another one.
export function createFocusSignal(emit: () => void): (spaceId: string | null, tabId: string | null) => void {
  let last: string | null = null
  return (spaceId, tabId) => {
    const focus = JSON.stringify([spaceId, tabId])
    if (focus === last) return
    last = focus
    emit()
  }
}
