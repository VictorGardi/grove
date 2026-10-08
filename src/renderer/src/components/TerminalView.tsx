import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalTheme } from '@shared/theme'
import s from './TerminalView.module.css'

// active: this terminal should hold the keyboard (it is the focused pane and no overlay is open)
export function TerminalView({ sessionId, active, onFocus }: { sessionId: string; active: boolean; onFocus?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const { api } = window
    const term = new Terminal({
      allowProposedApi: true,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true, // Option-drag selects in xterm, bypassing tmux's mouse
      theme: terminalTheme,
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.35,
    })
    // ⌃Tab is the Last Session menu accelerator: xterm would otherwise send it to the shell and swallow it.
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.key === 'Tab'))
    // tmux has the mouse, so a drag selects in tmux and it copies with OSC 52 ("52;c;<base64>").
    term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(';') + 1)
      if (b64 && b64 !== '?') {
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          void navigator.clipboard.writeText(new TextDecoder().decode(bytes)).catch(() => {})
        } catch {
          // not base64: ignore
        }
      }
      return true
    })
    // Copy on select, for xterm's own selections (Option-drag, or apps that take the mouse).
    const selection = term.onSelectionChange(() => {
      const text = term.getSelection()
      if (text) void navigator.clipboard.writeText(text).catch(() => {})
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // no WebGL: stay on the DOM renderer
    }
    fit.fit()
    termRef.current = term

    let attachId: string | null = null
    let disposed = false
    // pty:data can arrive before pty:attach resolves; hold it until we know our id
    const early: { attachId: string; data: string }[] = []
    const offData = api.on('pty:data', (p) => {
      if (attachId === null) early.push(p)
      else if (p.attachId === attachId) term.write(p.data)
    })
    const offExit = api.on('pty:exit', (p) => {
      if (p.attachId === attachId) term.write('\r\n[detached]\r\n')
    })
    const input = term.onData((data) => { if (attachId) api.send('pty:input', { attachId, data }) })

    void api.invoke('pty:attach', { sessionId, cols: term.cols, rows: term.rows }).then((res) => {
      if (!res.ok) return term.write(`\r\n${res.error}\r\n`)
      if (disposed) return api.send('pty:detach', { attachId: res.data.attachId })
      attachId = res.data.attachId
      for (const p of early) if (p.attachId === attachId) term.write(p.data)
      early.length = 0
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fit.fit()
        if (attachId) api.send('pty:resize', { attachId, cols: term.cols, rows: term.rows })
      }, 100)
    })
    ro.observe(ref.current!)

    return () => {
      disposed = true
      clearTimeout(timer)
      ro.disconnect()
      if (attachId) api.send('pty:detach', { attachId })
      offData()
      offExit()
      input.dispose()
      selection.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  // taking the keyboard back after an overlay (the palette) closes, and on mount
  useEffect(() => { if (active) termRef.current?.focus() }, [active, sessionId])

  return (
    <div className={s.frame}>
      <div ref={ref} className={s.term} onFocus={onFocus} />
    </div>
  )
}
