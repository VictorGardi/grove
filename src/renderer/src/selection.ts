// Shift-click range select over the cards in the order they are shown.

// Every id between the anchor and the target, inclusive. Without a visible anchor it is just the target.
export function selectRange(order: string[], anchor: string | null, target: string): Set<string> {
  const a = anchor === null ? -1 : order.indexOf(anchor)
  const b = order.indexOf(target)
  if (a < 0 || b < 0) return new Set([target])
  return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))
}
