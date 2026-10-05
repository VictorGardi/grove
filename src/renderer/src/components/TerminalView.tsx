import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalTheme } from '@shared/theme'

export function TerminalView({ sessionId }: { sessionId: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { api } = window
    const term = new Terminal({
      allowProposedApi: true,
      macOptionIsMeta: false,
      theme: terminalTheme,
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
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
    term.focus()

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
      term.dispose()
    }
  }, [sessionId])

  return <div ref={ref} style={{ flex: 1, minWidth: 0, height: '100%', padding: 4, boxSizing: 'border-box' }} />
}
