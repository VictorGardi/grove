// A branch name split for a middle cut: the head shrinks with an ellipsis, the tail always shows,
// so two long branches that share a prefix still read apart. A name too short to cut has no tail.
export const TAIL = 14

export function branchCut(branch: string): { head: string; tail: string } {
  if (branch.length <= TAIL + 4) return { head: branch, tail: '' }
  return { head: branch.slice(0, -TAIL), tail: branch.slice(-TAIL) }
}
