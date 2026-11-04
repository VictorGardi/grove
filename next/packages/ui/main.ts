import { invoke } from '@tauri-apps/api/core'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { openTerminal, type TerminalView } from './terminal.ts'
import type { TabInfo } from '../protocol/messages.ts'
import './styles.css'

interface EnvInfo {
  home: string
  shell: string
}

interface Tab {
  id: string
  attached: boolean
  exited: boolean
  queue: Uint8Array[] | null
  host: HTMLDivElement
  button: HTMLButtonElement
  view: TerminalView
}

const bridge = createBridge()
const encoder = new TextEncoder()
const tabs = new Map<string, Tab>()
const order: Tab[] = []
let active: Tab | null = null
let env: EnvInfo | null = null

const tabStrip = byId('tabs')
const terminals = byId('terminals')
const statusLine = byId('status')

function byId(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing #${id}`)
  return element
}

function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  statusLine.textContent = message
}

function createTab(): Tab {
  const host = document.createElement('div')
  host.className = 'term-host'
  host.hidden = true
  terminals.append(host)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tab'
  button.setAttribute('role', 'tab')
  button.addEventListener('click', () => activate(tab))
  tabStrip.append(button)

  const tab: Tab = {
    id: '',
    attached: false,
    exited: false,
    queue: null,
    host,
    button,
    view: undefined as unknown as TerminalView,
  }
  tab.view = openTerminal(host, {
    onInput: (text) => {
      if (tab.attached) void bridge.rpc('tabs.write', { id: tab.id, dataB64: toBase64(encoder.encode(text)) }).catch(report)
    },
    onResize: (cols, rows) => {
      if (tab.attached) void bridge.rpc('tabs.resize', { id: tab.id, cols, rows }).catch(report)
    },
    onContextLoss: () => console.warn(`WebGL context lost in tab ${tab.id}; using the DOM renderer`),
  })
  return tab
}

function adopt(tab: Tab, id: string): void {
  tab.id = id
  tabs.set(id, tab)
  order.push(tab)
  tab.button.textContent = String(order.length)
  tab.button.title = `Tab ${order.length}`
}

function removeTab(tab: Tab): void {
  tab.host.remove()
  tab.button.remove()
  if (tab.id) tabs.delete(tab.id)
  const index = order.indexOf(tab)
  if (index !== -1) order.splice(index, 1)
  if (active === tab) active = null
}

function deliver(tab: Tab, bytes: Uint8Array): void {
  if (tab.queue) tab.queue.push(bytes)
  else tab.view.write(bytes)
}

function markExited(tab: Tab, exitCode: number | null = null): void {
  if (tab.exited) return
  tab.exited = true
  tab.attached = false
  tab.button.classList.add('exited')
  const code = exitCode === null ? '' : ` with code ${exitCode}`
  deliver(tab, encoder.encode(`\r\n\x1b[2m[process exited${code}]\x1b[0m\r\n`))
}

// Shows the core's saved screen first, then output that arrived while the attach was in flight.
async function attach(tab: Tab): Promise<void> {
  tab.queue = []
  try {
    const { screenB64 } = await bridge.rpc('tabs.attach', { id: tab.id })
    tab.view.reset()
    tab.view.write(fromBase64(screenB64))
    const pending = tab.queue
    tab.queue = null
    for (const bytes of pending) tab.view.write(bytes)
  } finally {
    tab.queue = null
  }
  tab.attached = true
  tab.exited = false
  tab.button.classList.remove('exited')
  const { cols, rows } = tab.view.term
  await bridge.rpc('tabs.resize', { id: tab.id, cols, rows })
}

function activate(tab: Tab): void {
  active = tab
  for (const other of order) {
    const on = other === tab
    other.host.hidden = !on
    other.button.classList.toggle('active', on)
    other.button.setAttribute('aria-selected', String(on))
  }
  tab.view.fit()
  tab.view.term.focus()
}

async function newShellTab(): Promise<void> {
  if (!env) return
  const tab = createTab()
  try {
    const { id } = await bridge.rpc('tabs.create', {
      command: env.shell,
      args: ['-l'],
      cwd: env.home,
      cols: tab.view.term.cols,
      rows: tab.view.term.rows,
    })
    adopt(tab, id)
    await attach(tab)
    activate(tab)
  } catch (error) {
    removeTab(tab)
    report(error)
  }
}

// Brings the page in line with the core: alive tabs are shown and reattached, gone ones are marked.
async function resync(): Promise<void> {
  const list: TabInfo[] = await bridge.rpc('tabs.list', {})
  const alive = new Set(list.filter((info) => info.alive).map((info) => info.id))
  for (const tab of order) if (!alive.has(tab.id)) markExited(tab)
  for (const info of list) {
    if (!info.alive) continue
    const existing = tabs.get(info.id)
    if (existing) {
      await attach(existing)
    } else {
      const tab = createTab()
      adopt(tab, info.id)
      await attach(tab)
    }
  }
  if (!active && order.length > 0) activate(order[0]!)
}

bridge.on('tabs.output', ({ id, dataB64 }) => {
  const tab = tabs.get(id)
  if (tab) deliver(tab, fromBase64(dataB64))
})

bridge.on('tabs.exit', ({ id, exitCode }) => {
  const tab = tabs.get(id)
  if (tab) markExited(tab, exitCode)
})

bridge.onStatus((status) => {
  if (status === 'closed') {
    statusLine.textContent = 'Reconnecting to the core...'
    return
  }
  statusLine.textContent = ''
  resync().catch(report)
})

new ResizeObserver(() => active?.view.fit()).observe(terminals)
byId('new-tab').addEventListener('click', () => void newShellTab())

async function start(): Promise<void> {
  if (import.meta.env.DEV) byId('stress-link').hidden = false
  env = await invoke<EnvInfo>('env_info')
  await bridge.connect()
  await resync()
  if (order.length === 0) await newShellTab()
}

start().catch((error: unknown) => {
  report(error instanceof Error ? `Could not start: ${error.message}` : error)
})
