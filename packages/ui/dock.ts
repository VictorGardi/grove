// The dock: the right sidebar, one panel at a time. A panel is a module with a title, a body it draws into, and a way to say how it is
// doing (a status line, a side note, an error). The notes are the first panel; the diff and the comments will be panels too, so everything
// they share lives here: the header, the close and expand buttons, the shortcut chip, the resize edge, the width, and the focus hand-back.
// The dock is not modal: terminals refit beside it and the window's key bindings keep working while it has focus.
import {
  clampDockWidth,
  dockCeiling,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_STEP,
  dockWidthFor,
  readDockExpanded,
  readDockWidth,
  writeDockExpanded,
  writeDockWidth,
} from './dock-state.ts'
import type { KeyValueStore } from './sidebar-state.ts'

// What a panel uses to speak in the dock's header and under it.
export interface DockContext {
  status(text: string): void
  meta(text: string): void
  error(message: string | null): void
  close(): void
}

export interface DockInstance {
  focus(): void
  destroy(): void
  // Asked before the panel closes or gives way to another. False keeps it open (the panel has said why through `error`).
  canClose?(): Promise<boolean>
}

export interface DockPanel {
  id: string
  title: string
  mount(body: HTMLElement, context: DockContext): DockInstance
}

export interface DockElements {
  app: HTMLElement
  dock: HTMLElement
  title: HTMLElement
  status: HTMLElement
  meta: HTMLElement
  error: HTMLElement
  body: HTMLElement
  close: HTMLButtonElement
  expand: HTMLButtonElement
  edge: HTMLElement
}

export interface DockDeps {
  store: KeyValueStore | null
  // How wide the window is; the dock never takes more than a share of it. Default: the window's inner width.
  windowWidth?(): number
  // Sets the dock's width on the window, so the grid and the terminals follow it.
  applyWidth(width: number): void
  // The dock has closed: hand the keyboard back.
  closed(): void
  // The open panel changed: its id, or null when the dock is closed. Buttons that show the panel follow it.
  changed?(id: string | null): void
}

// How long the dock takes to slide shut, the same as --sidebar-ease in tokens.css. A closed panel is taken down after it, so its
// content stays in view while the card shrinks.
export const DOCK_SLIDE_MS = 200

export interface Dock {
  register(panel: DockPanel): void
  open(id: string): Promise<void>
  toggle(id: string): Promise<void>
  close(): Promise<boolean>
  current(): string | null
  // Expands the open dock to most of the window, or puts it back; does nothing while the dock is closed.
  toggleExpanded(): void
}

export function createDock(elements: DockElements, deps: DockDeps): Dock {
  const { app, dock, title, status, meta, error, body, close: closeButton, expand: expandButton, edge } = elements
  const panels = new Map<string, DockPanel>()
  let shown: { panel: DockPanel; instance: DockInstance } | null = null
  // The width the human chose (dragged, stepped or reset to); expanded shows the ceiling instead and keeps it for the way back.
  let width = readDockWidth(deps.store)
  let expanded = readDockExpanded(deps.store)
  let mounting: DockPanel | null = null
  let leaving: { instance: DockInstance; timer: ReturnType<typeof setTimeout> | null } | null = null
  let busy: Promise<unknown> = Promise.resolve()

  const windowWidth = (): number => deps.windowWidth?.() ?? window.innerWidth
  const shownWidth = (): number => dockWidthFor(width, expanded, windowWidth())

  // Puts the shown width on the window, so the grid and the terminals follow it, and the edge and the button say what it is.
  function apply(): void {
    const shown = shownWidth()
    deps.applyWidth(shown)
    edge.setAttribute('aria-valuenow', String(shown))
    edge.setAttribute('aria-valuemax', String(dockCeiling(windowWidth())))
    expandButton.setAttribute('aria-pressed', String(expanded))
    app.classList.toggle('dock-expanded', expanded)
  }

  // A width the human chose: it ends expanded, and is kept when `keep`.
  function setWidth(next: number, keep: boolean): void {
    width = clampDockWidth(next, windowWidth())
    expanded = false
    apply()
    if (keep) {
      writeDockWidth(deps.store, width)
      writeDockExpanded(deps.store, false)
    }
  }

  function toggleExpanded(): void {
    if (!shown && !mounting) return
    expanded = !expanded
    apply()
    writeDockExpanded(deps.store, expanded)
  }

  function context(panel: DockPanel): DockContext {
    // A panel that has closed may still finish work (a save); what it says then is not shown.
    const mine = (): boolean => shown?.panel === panel || mounting === panel
    return {
      status: (text) => mine() && void (status.textContent = text),
      meta: (text) => mine() && void (meta.textContent = text),
      error: (message) => {
        if (!mine()) return
        error.hidden = message === null
        error.textContent = message ?? ''
      },
      close: () => void queue(() => closeNow()),
    }
  }

  // Takes down a panel that has closed: its instance, its body and its header text. Runs when the slide is over, or before the next panel opens.
  function finishLeaving(): void {
    if (!leaving) return
    if (leaving.timer) clearTimeout(leaving.timer)
    leaving.instance.destroy()
    leaving = null
    body.replaceChildren()
    for (const el of [status, meta, error]) el.textContent = ''
    error.hidden = true
  }

  // Ends the open panel, if it agrees. `keepOpen` is a swap: the dock stays where it is and the keyboard is not handed back.
  async function closeNow(keepOpen = false): Promise<boolean> {
    const current = shown
    if (!current) return true
    if (current.instance.canClose && !(await current.instance.canClose())) return false
    if (shown !== current) return true
    shown = null
    if (keepOpen) {
      leaving = { instance: current.instance, timer: null }
      finishLeaving()
      return true
    }
    app.classList.remove('dock-open')
    leaving = { instance: current.instance, timer: setTimeout(finishLeaving, DOCK_SLIDE_MS) }
    deps.changed?.(null)
    deps.closed()
    return true
  }

  async function openNow(id: string): Promise<void> {
    const panel = panels.get(id)
    if (!panel || shown?.panel === panel) return shown?.instance.focus()
    if (!(await closeNow(true))) return
    finishLeaving()
    title.textContent = panel.title
    dock.dataset.panel = panel.id
    app.classList.add('dock-open')
    apply()
    mounting = panel
    const instance = panel.mount(body, context(panel))
    mounting = null
    shown = { panel, instance }
    deps.changed?.(panel.id)
    instance.focus()
  }

  // Calls run one after another, so a quick double press cannot open a panel while the last one is still closing.
  const queue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = busy.then(work, work)
    busy = next.catch(() => undefined)
    return next
  }

  closeButton.addEventListener('click', () => void queue(() => closeNow()))
  dock.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) void queue(() => closeNow())
  })

  // The left edge resizes: drag it, or focus it and use the arrow keys. A double click puts the width back.
  edge.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    edge.setPointerCapture(event.pointerId)
    app.classList.add('dock-resizing')
    const move = (e: PointerEvent): void => setWidth(app.getBoundingClientRect().right - e.clientX, false)
    const stop = (): void => {
      edge.removeEventListener('pointermove', move)
      edge.removeEventListener('pointerup', stop)
      edge.removeEventListener('pointercancel', stop)
      app.classList.remove('dock-resizing')
      writeDockWidth(deps.store, width)
      writeDockExpanded(deps.store, expanded)
    }
    edge.addEventListener('pointermove', move)
    edge.addEventListener('pointerup', stop)
    edge.addEventListener('pointercancel', stop)
  })
  edge.addEventListener('keydown', (event) => {
    const grow = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
    if (grow === 0) return
    event.preventDefault()
    setWidth(shownWidth() + grow * DOCK_WIDTH_STEP, true)
  })
  edge.addEventListener('dblclick', () => setWidth(DOCK_WIDTH_DEFAULT, true))
  expandButton.addEventListener('click', toggleExpanded)
  window.addEventListener('resize', apply)
  apply()

  return {
    register: (panel) => void panels.set(panel.id, panel),
    open: (id) => queue(() => openNow(id)),
    toggle: (id) => queue(() => (shown?.panel.id === id ? closeNow().then(() => undefined) : openNow(id))),
    close: () => queue(() => closeNow()),
    current: () => shown?.panel.id ?? null,
    toggleExpanded,
  }
}
