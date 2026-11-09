import { gridShape, type PaneDirection } from './layout.ts'

// 'row' puts a left of b, 'col' puts a above b. ratio is a's share of the split's space.
export type SplitDir = 'row' | 'col'
export interface Split {
  dir: SplitDir
  ratio: number
  a: Tree
  b: Tree
}
// A custom grid layout: a leaf is a tab id, a split divides its space between two subtrees.
export type Tree = string | Split

// A pane's place in the unit square.
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A chain of items, each taking an equal share of what is left, the last one the rest.
function chain(dir: SplitDir, items: Tree[], share: number): Tree {
  if (items.length === 1) return items[0]
  return { dir, ratio: share, a: items[0], b: chain(dir, items.slice(1), 1 / (items.length - 1)) }
}

// The tree the automatic grid draws for these panes: rows of equal columns, the last pane stretching across the rest of its row.
export function autoTree(ids: string[]): Tree | null {
  if (ids.length === 0) return null
  const { cols, rows } = gridShape(ids.length)
  const lines: Tree[] = []
  for (let row = 0; row < rows; row++) {
    const line = ids.slice(row * cols, (row + 1) * cols)
    lines.push(chain('row', line, 1 / cols))
  }
  return chain('col', lines, 1 / rows)
}

// Where each pane sits in the unit square.
export function layoutRects(tree: Tree, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): Record<string, Rect> {
  if (typeof tree === 'string') return { [tree]: area }
  const [first, second] = childAreas(tree, area)
  return { ...layoutRects(tree.a, first), ...layoutRects(tree.b, second) }
}

function childAreas(split: Split, area: Rect): [Rect, Rect] {
  const first = split.dir === 'row' ? { ...area, w: area.w * split.ratio } : { ...area, h: area.h * split.ratio }
  const second = split.dir === 'row'
    ? { x: area.x + first.w, y: area.y, w: area.w - first.w, h: area.h }
    : { x: area.x, y: area.y + first.h, w: area.w, h: area.h - first.h }
  return [first, second]
}

// A pane's size in pixels, or the area's: only the proportions matter.
export interface Size {
  w: number
  h: number
}

// Splits the target pane in half and puts the new pane after it, across a wide pane and down a tall one. A target not in the tree is split from the last pane.
export function addPane(tree: Tree, target: string, id: string, size: Size = { w: 1, h: 1 }): Tree {
  const rects = layoutRects(tree)
  const at = target in rects ? target : Object.keys(rects).at(-1)!
  const rect = rects[at]
  const dir: SplitDir = rect.w * size.w >= rect.h * size.h ? 'row' : 'col'
  const split = (leaf: Tree): Tree => {
    if (typeof leaf === 'string') return leaf === at ? { dir, ratio: 0.5, a: leaf, b: id } : leaf
    return { ...leaf, a: split(leaf.a), b: split(leaf.b) }
  }
  return split(tree)
}

// Takes a pane out; its sibling takes the space. Nothing is left when it was the last pane.
export function removePane(tree: Tree, id: string): Tree | null {
  if (typeof tree === 'string') return tree === id ? null : tree
  const a = removePane(tree.a, id)
  const b = removePane(tree.b, id)
  if (a === null) return b
  if (b === null) return a
  return { ...tree, a, b }
}

// Trades two panes' places; the splits and their sizes stay.
export function swapPanes(tree: Tree, x: string, y: string): Tree {
  const swap = (node: Tree): Tree => {
    if (typeof node === 'string') return node === x ? y : node === y ? x : node
    return { ...node, a: swap(node.a), b: swap(node.b) }
  }
  const rects = layoutRects(tree)
  return x === y || !(x in rects) || !(y in rects) ? tree : swap(tree)
}

export type Edge = 'left' | 'right' | 'top' | 'bottom'

// Moves a pane to an edge of another: its old slot goes to its sibling and the target's space is split in half.
export function dockPane(tree: Tree, moving: string, target: string, edge: Edge): Tree {
  const rects = layoutRects(tree)
  if (moving === target || !(moving in rects) || !(target in rects)) return tree
  const rest = removePane(tree, moving)!
  const dir: SplitDir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const before = edge === 'left' || edge === 'top'
  const dock = (node: Tree): Tree => {
    if (typeof node === 'string') {
      return node === target ? { dir, ratio: 0.5, a: before ? moving : node, b: before ? node : moving } : node
    }
    return { ...node, a: dock(node.a), b: dock(node.b) }
  }
  return dock(rest)
}

export type Path = ('a' | 'b')[]

// A split as a divider sees it: where it is in the tree, the area it divides and the share of that area the first side holds.
export interface Divider {
  path: Path
  dir: SplitDir
  area: Rect
  ratio: number
}

// Every split in the tree, parents before children.
export function dividers(tree: Tree, area: Rect = { x: 0, y: 0, w: 1, h: 1 }, path: Path = []): Divider[] {
  if (typeof tree === 'string') return []
  const [first, second] = childAreas(tree, area)
  return [
    { path, dir: tree.dir, area, ratio: tree.ratio },
    ...dividers(tree.a, first, [...path, 'a']),
    ...dividers(tree.b, second, [...path, 'b']),
  ]
}

// The least room a subtree needs when every pane needs min.
function minSize(tree: Tree, min: Size): Size {
  if (typeof tree === 'string') return min
  const a = minSize(tree.a, min)
  const b = minSize(tree.b, min)
  return tree.dir === 'row' ? { w: a.w + b.w, h: Math.max(a.h, b.h) } : { w: Math.max(a.w, b.w), h: a.h + b.h }
}

function nodeAt(tree: Tree, path: Path): Tree | undefined {
  let node: Tree | undefined = tree
  for (const step of path) node = typeof node === 'object' ? node[step] : undefined
  return node
}

function replaceAt(tree: Tree, path: Path, make: (node: Split) => Tree): Tree {
  if (path.length === 0) return typeof tree === 'string' ? tree : make(tree)
  if (typeof tree === 'string') return tree
  const [step, ...rest] = path
  return { ...tree, [step]: replaceAt(tree[step], rest, make) }
}

// Moves the divider of the split at path to ratio, held back so both sides keep room for their panes. size is the whole area in pixels.
export function resizeSplit(tree: Tree, path: Path, ratio: number, size: Size, min: Size): Tree {
  const split = nodeAt(tree, path)
  const found = dividers(tree).find((d) => d.path.join() === path.join())
  if (typeof split !== 'object' || !found) return tree
  const total = split.dir === 'row' ? found.area.w * size.w : found.area.h * size.h
  const axis = split.dir === 'row' ? 'w' : 'h'
  const lo = minSize(split.a, min)[axis] / total
  const hi = 1 - minSize(split.b, min)[axis] / total
  if (lo > hi) return tree
  const next = Math.min(hi, Math.max(lo, ratio))
  return replaceAt(tree, path, (node) => ({ ...node, ratio: next }))
}

// Moves the divider next to a pane one step in the key's direction: the pane's own edge that way, else the one on its other side.
export function nudge(tree: Tree, id: string, direction: PaneDirection, step: number, size: Size, min: Size): Tree {
  const dir: SplitDir = direction === 'left' || direction === 'right' ? 'row' : 'col'
  const forward = direction === 'right' || direction === 'down'
  // The splits above the pane, nearest first, with the side the pane is on.
  const above: { path: Path; side: 'a' | 'b' }[] = []
  const walk = (node: Tree, path: Path): boolean => {
    if (typeof node === 'string') return node === id
    for (const side of ['a', 'b'] as const) {
      if (walk(node[side], [...path, side])) {
        if (node.dir === dir) above.push({ path, side })
        return true
      }
    }
    return false
  }
  if (!walk(tree, [])) return tree
  const edge = forward ? 'a' : 'b'
  const hit = above.find((x) => x.side === edge) ?? above[0]
  if (!hit) return tree
  const split = nodeAt(tree, hit.path) as Split
  return resizeSplit(tree, hit.path, split.ratio + (forward ? step : -step), size, min)
}

// How many panes a subtree lays side by side (or stacked) along a direction.
function tracks(tree: Tree, dir: SplitDir): number {
  return typeof tree === 'string' || tree.dir !== dir ? 1 : tracks(tree.a, dir) + tracks(tree.b, dir)
}

// Shares a split's space equally between the panes along its direction, and does the same for splits chained in that direction.
export function equalize(tree: Tree, path: Path): Tree {
  const node = nodeAt(tree, path)
  if (typeof node !== 'object') return tree
  const share = (split: Split): Tree => {
    const a = typeof split.a === 'object' && split.a.dir === split.dir ? share(split.a) : split.a
    const b = typeof split.b === 'object' && split.b.dir === split.dir ? share(split.b) : split.b
    return { ...split, ratio: tracks(split.a, split.dir) / (tracks(split.a, split.dir) + tracks(split.b, split.dir)), a, b }
  }
  return replaceAt(tree, path, share)
}

// The pane next to another in a direction, or the same pane when there is none. Of several that touch it, the one facing its middle.
export function neighborByGeometry(tree: Tree, id: string, direction: PaneDirection): string {
  const rects = layoutRects(tree)
  const from = rects[id]
  if (!from) return id
  const horizontal = direction === 'left' || direction === 'right'
  const forward = direction === 'right' || direction === 'down'
  const eps = 1e-9
  const start = (r: Rect) => (horizontal ? r.x : r.y)
  const length = (r: Rect) => (horizontal ? r.w : r.h)
  const crossStart = (r: Rect) => (horizontal ? r.y : r.x)
  const crossLength = (r: Rect) => (horizontal ? r.h : r.w)
  const middle = crossStart(from) + crossLength(from) / 2
  const touching = Object.entries(rects)
    .filter(([other, r]) => {
      if (other === id) return false
      const gap = forward ? start(r) - (start(from) + length(from)) : start(from) - (start(r) + length(r))
      const overlap = Math.min(crossStart(r) + crossLength(r), crossStart(from) + crossLength(from)) - Math.max(crossStart(r), crossStart(from))
      return Math.abs(gap) < eps && overlap > eps
    })
  if (touching.length === 0) return id
  const faces = (r: Rect) => crossStart(r) <= middle + eps && middle <= crossStart(r) + crossLength(r) + eps
  return (touching.find(([, r]) => faces(r)) ?? touching[0])[0]
}

const MIN_RATIO = 0.02

// Reads a saved tree back: shape checked, ratios kept off the edges. Null for anything that is not a tree, or names a pane twice.
export function readTree(saved: unknown): Tree | null {
  const seen = new Set<string>()
  const read = (node: unknown): Tree | null => {
    if (typeof node === 'string') {
      if (seen.has(node)) return null
      seen.add(node)
      return node
    }
    if (typeof node !== 'object' || node === null) return null
    const { dir, ratio, a, b } = node as Record<string, unknown>
    if ((dir !== 'row' && dir !== 'col') || typeof ratio !== 'number' || !Number.isFinite(ratio)) return null
    const first = read(a)
    const second = read(b)
    if (first === null || second === null) return null
    return { dir, ratio: Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)), a: first, b: second }
  }
  return read(saved)
}

// Fits a saved tree to the current members: panes that are no longer members dropped, new members split in. Anything that is not a tree gives the automatic one.
export function repair(saved: unknown, members: string[]): Tree | null {
  if (members.length === 0) return null
  let tree = readTree(saved)
  if (tree === null) return autoTree(members)
  for (const id of Object.keys(layoutRects(tree))) {
    if (!members.includes(id)) tree = removePane(tree!, id)
  }
  for (const id of members) {
    if (tree === null) tree = id
    else if (!(id in layoutRects(tree))) tree = addPane(tree, Object.keys(layoutRects(tree)).at(-1)!, id)
  }
  return tree
}
