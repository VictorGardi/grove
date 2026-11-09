import { dividers, dockPane, equalize, layoutRects, resizeSplit, swapPanes, type Edge, type Path, type Rect, type Size, type Tree } from './tree.ts'

// The least room a pane keeps when a divider is dragged: about 20 columns by 5 rows of terminal.
export const PANE_MIN: Size = { w: 160, h: 96 }

// How far a pane header moves before it counts as a drag and not a click.
const DRAG_START = 4
const EPS = 1e-6

export interface Arranger {
  // Places the panes by the tree and draws the dividers between them; null clears both.
  paint(tree: Tree | null): void
  // Lets the pane's header start a drag of that pane.
  grab(head: HTMLElement, id: () => string): void
}

export interface ArrangeHost {
  container: HTMLElement
  tree(): Tree | null
  pane(id: string): HTMLElement | undefined
  // The human changed the layout: it is theirs from now on.
  change(tree: Tree): void
}

// An inset from one side of the container: the container's margin at the edge, half a gap against a neighbour.
function inset(fraction: number): string {
  return fraction <= EPS ? 'var(--space-3)' : `calc(${fraction * 100}% + var(--grid-half-gap))`
}

export function placeRect(element: HTMLElement, rect: Rect): void {
  element.style.left = inset(rect.x)
  element.style.top = inset(rect.y)
  element.style.right = inset(1 - rect.x - rect.w)
  element.style.bottom = inset(1 - rect.y - rect.h)
}

export function clearPlacement(element: HTMLElement): void {
  for (const side of ['left', 'top', 'right', 'bottom'] as const) element.style[side] = ''
}

// Which part of a pane a point is over: its middle swaps, a side docks there.
export function dropZone(fx: number, fy: number): Edge | 'swap' {
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return 'swap'
  const near = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ] as const
  return near.reduce((best, item) => (item[1] < best[1] ? item : best))[0]
}

export function createArranger(host: ArrangeHost): Arranger {
  const { container } = host
  let dividerEls: HTMLElement[] = []
  const drop = document.createElement('div')
  drop.className = 'grid-drop'
  drop.hidden = true
  container.append(drop)

  function size(): Size {
    const box = container.getBoundingClientRect()
    return { w: box.width, h: box.height }
  }

  function dragDivider(event: PointerEvent, path: Path, area: Rect, dir: 'row' | 'col'): void {
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.classList.add('dragging')
    // Every change repaints the dividers, this one included, so the drag follows the pointer on the window and not on the handle.
    const move = (at: PointerEvent): void => {
      const tree = host.tree()
      if (!tree) return
      const box = container.getBoundingClientRect()
      const along = dir === 'row' ? (at.clientX - box.left) / box.width : (at.clientY - box.top) / box.height
      const ratio = (along - (dir === 'row' ? area.x : area.y)) / (dir === 'row' ? area.w : area.h)
      host.change(resizeSplit(tree, path, ratio, size(), PANE_MIN))
    }
    const end = (): void => {
      handle.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  function paint(tree: Tree | null): void {
    for (const el of dividerEls) el.remove()
    dividerEls = []
    if (!tree) return
    const rects = layoutRects(tree)
    for (const [id, rect] of Object.entries(rects)) {
      const pane = host.pane(id)
      if (pane) placeRect(pane, rect)
    }
    for (const { path, dir, area, ratio } of dividers(tree)) {
      const handle = document.createElement('div')
      handle.className = `grid-divider ${dir}`
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', dir === 'row' ? 'vertical' : 'horizontal')
      handle.title = 'Drag to resize. Double-click to equalize.'
      if (dir === 'row') {
        handle.style.left = `${(area.x + area.w * ratio) * 100}%`
        handle.style.top = `${area.y * 100}%`
        handle.style.height = `${area.h * 100}%`
      } else {
        handle.style.top = `${(area.y + area.h * ratio) * 100}%`
        handle.style.left = `${area.x * 100}%`
        handle.style.width = `${area.w * 100}%`
      }
      handle.addEventListener('pointerdown', (event) => dragDivider(event, path, area, dir))
      handle.addEventListener('dblclick', () => {
        const current = host.tree()
        if (current) host.change(equalize(current, path))
      })
      dividerEls.push(handle)
      container.append(handle)
    }
  }

  // The pane under a point, with where in it the point is.
  function target(tree: Tree, from: string, x: number, y: number): { id: string; rect: Rect; zone: Edge | 'swap' } | null {
    const box = container.getBoundingClientRect()
    const fx = (x - box.left) / box.width
    const fy = (y - box.top) / box.height
    for (const [id, rect] of Object.entries(layoutRects(tree))) {
      if (id === from || fx < rect.x || fx > rect.x + rect.w || fy < rect.y || fy > rect.y + rect.h) continue
      return { id, rect, zone: dropZone((fx - rect.x) / rect.w, (fy - rect.y) / rect.h) }
    }
    return null
  }

  function showDrop(rect: Rect, zone: Edge | 'swap'): void {
    const part = { ...rect }
    if (zone === 'left') part.w = rect.w / 2
    if (zone === 'right') { part.x = rect.x + rect.w / 2; part.w = rect.w / 2 }
    if (zone === 'top') part.h = rect.h / 2
    if (zone === 'bottom') { part.y = rect.y + rect.h / 2; part.h = rect.h / 2 }
    placeRect(drop, part)
    drop.classList.toggle('swap', zone === 'swap')
    drop.hidden = false
  }

  function grab(head: HTMLElement, tabId: () => string): void {
    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return
      const tree = host.tree()
      const id = tabId()
      if (!tree || typeof tree === 'string' || !(id in layoutRects(tree))) return
      const startX = event.clientX
      const startY = event.clientY
      let dragging = false
      let over: ReturnType<typeof target> = null
      const move = (at: PointerEvent): void => {
        if (!dragging && Math.hypot(at.clientX - startX, at.clientY - startY) < DRAG_START) return
        if (!dragging) {
          dragging = true
          head.setPointerCapture(event.pointerId)
          container.classList.add('arranging')
        }
        over = target(tree, id, at.clientX, at.clientY)
        if (over) showDrop(over.rect, over.zone)
        else drop.hidden = true
      }
      const finish = (apply: boolean): void => {
        head.removeEventListener('pointermove', move)
        head.removeEventListener('pointerup', up)
        head.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
        container.classList.remove('arranging')
        drop.hidden = true
        if (dragging && apply && over) {
          const next = over.zone === 'swap' ? swapPanes(tree, id, over.id) : dockPane(tree, id, over.id, over.zone)
          if (next !== tree) host.change(next)
        }
      }
      const up = (): void => finish(true)
      const cancel = (): void => finish(false)
      // Esc cancels the drag and goes no further: the terminal under it must not get it.
      const key = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
      head.addEventListener('pointermove', move)
      head.addEventListener('pointerup', up)
      head.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
    })
  }

  return { paint, grab }
}
