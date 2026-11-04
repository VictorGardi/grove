import { invoke } from '@tauri-apps/api/core'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'
import { openTerminal, type TerminalView } from './terminal.ts'
import './styles.css'

const PANES = 9
const PROBE_EVERY_MS = 200
const ECHO_TIMEOUT_MS = 2000
const PROBE = 0x51 // "Q": the streamed lines contain no Q, so an echo is unambiguous
const ERASE = '\x7f'
const LOOP = 'i=0; while :; do i=$((i+1)); printf "stress line %d ....................................................\\n" "$i"; sleep 0.01; done'

interface Pane {
  id: string
  view: TerminalView
  host: HTMLDivElement
  probeAt: number | null
}

interface Run {
  panes: Map<string, Pane>
  frames: number[]
  echoes: number[]
  timeouts: number
  lostContexts: number
  bytes: number
  stopped: boolean
}

const bridge = createBridge()
const encoder = new TextEncoder()
const gridEl = document.getElementById('grid') as HTMLDivElement
const resultsEl = document.getElementById('results') as HTMLPreElement
const stateEl = document.getElementById('state') as HTMLSpanElement
const startButton = document.getElementById('start') as HTMLButtonElement
const secondsInput = document.getElementById('seconds') as HTMLInputElement

let current: Run | null = null

bridge.on('tabs.output', ({ id, dataB64 }) => {
  const run = current
  const pane = run?.panes.get(id)
  if (!run || !pane) return
  const bytes = fromBase64(dataB64)
  run.bytes += bytes.length
  const probeAt = bytes.includes(PROBE) ? pane.probeAt : null
  pane.view.write(bytes, () => {
    if (probeAt === null || probeAt !== pane.probeAt) return
    run.echoes.push(performance.now() - probeAt)
    pane.probeAt = null
    void bridge.rpc('tabs.write', { id, dataB64: toBase64(encoder.encode(ERASE)) }).catch(report)
  })
})

function report(error: unknown): void {
  console.error(error)
  stateEl.textContent = error instanceof Error ? error.message : String(error)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? NaN
}

function round(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'n/a'
}

async function startRun(home: string, seconds: number): Promise<void> {
  const run: Run = {
    panes: new Map(),
    frames: [],
    echoes: [],
    timeouts: 0,
    lostContexts: 0,
    bytes: 0,
    stopped: false,
  }
  current = run
  const started = performance.now()
  stateEl.textContent = 'starting panes'

  const hosts: HTMLDivElement[] = []
  for (let i = 0; i < PANES; i++) {
    const host = document.createElement('div')
    host.className = 'term-host'
    host.addEventListener('webglcontextlost', () => run.lostContexts++, true)
    gridEl.append(host)
    hosts.push(host)
  }

  const created: Pane[] = []
  for (const host of hosts) {
    const view = openTerminal(host, {
      onInput: () => {},
      onResize: (cols, rows) => {
        const pane = created.find((candidate) => candidate.host === host)
        if (pane) void bridge.rpc('tabs.resize', { id: pane.id, cols, rows }).catch(report)
      },
    })
    const { id } = await bridge.rpc('tabs.create', {
      command: '/bin/sh',
      args: ['-c', LOOP],
      cwd: home,
      cols: view.term.cols,
      rows: view.term.rows,
    })
    await bridge.rpc('tabs.attach', { id })
    const pane: Pane = { id, view, host, probeAt: null }
    created.push(pane)
    run.panes.set(id, pane)
  }

  const frame = (now: number) => {
    if (run.stopped) return
    run.frames.push(now - last)
    last = now
    requestAnimationFrame(frame)
  }
  let last = performance.now()
  requestAnimationFrame(frame)

  let nextPane = 0
  const probe = setInterval(() => {
    const now = performance.now()
    for (const pane of created) {
      if (pane.probeAt !== null && now - pane.probeAt > ECHO_TIMEOUT_MS) {
        run.timeouts++
        pane.probeAt = null
      }
    }
    const pane = created[nextPane]
    nextPane = (nextPane + 1) % created.length
    if (!pane || pane.probeAt !== null) return
    pane.probeAt = performance.now()
    void bridge.rpc('tabs.write', { id: pane.id, dataB64: toBase64(Uint8Array.of(PROBE)) }).catch(report)
  }, PROBE_EVERY_MS)

  stateEl.textContent = `running for ${seconds} s`
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  clearInterval(probe)
  run.stopped = true
  const elapsed = (performance.now() - started) / 1000

  for (const pane of created) {
    await bridge.rpc('tabs.kill', { id: pane.id }).catch(report)
    pane.view.dispose()
    pane.host.remove()
  }
  current = null
  summarise(run, elapsed)
}

function summarise(run: Run, elapsed: number): void {
  const fps = run.frames.length / elapsed
  const maxFrame = Math.max(0, ...run.frames)
  const median = percentile(run.echoes, 0.5)
  const p95 = percentile(run.echoes, 0.95)
  const checks = [
    ['no frame over 1 s', maxFrame < 1000],
    ['no lost WebGL context', run.lostContexts === 0],
    ['average fps >= 30', fps >= 30],
    ['echo median <= 50 ms', median <= 50],
    ['echo p95 <= 100 ms', p95 <= 100],
  ] as const
  const verdict = checks.every(([, ok]) => ok) ? 'PASS' : 'FAIL'
  const lines = [
    `${new Date().toLocaleTimeString()} run ${verdict} (${elapsed.toFixed(0)} s, ${PANES} panes)`,
    `  key echo: median ${round(median)} ms, p95 ${round(p95)} ms, n ${run.echoes.length}, timeouts ${run.timeouts}`,
    `  frames: average ${round(fps)} fps, longest ${round(maxFrame)} ms, n ${run.frames.length}`,
    `  lost WebGL contexts: ${run.lostContexts}`,
    `  output: ${round(run.bytes / elapsed / 1024)} KiB/s`,
    ...checks.map(([name, ok]) => `  ${ok ? 'ok  ' : 'FAIL'} ${name}`),
  ]
  const text = lines.join('\n') + '\n'
  resultsEl.textContent = (resultsEl.textContent ?? '') + text
  console.info(text, { frames: run.frames, echoes: run.echoes })
  stateEl.textContent = `last run ${verdict}`
}

new ResizeObserver(() => {
  for (const pane of current?.panes.values() ?? []) pane.view.fit()
}).observe(gridEl)

async function main(): Promise<void> {
  const env = await invoke<{ home: string }>('env_info')
  await bridge.connect()
  startButton.addEventListener('click', () => {
    if (current) return
    const seconds = Math.max(5, Number(secondsInput.value) || 60)
    startButton.disabled = true
    startRun(env.home, seconds)
      .catch(report)
      .finally(() => {
        startButton.disabled = false
      })
  })
  stateEl.textContent = 'ready'
}

main().catch(report)
