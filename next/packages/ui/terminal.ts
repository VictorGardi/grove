import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TerminalView {
  term: Terminal
  write(bytes: Uint8Array, done?: () => void): void
  reset(): void
  fit(): void
  dispose(): void
}

export interface TerminalOptions {
  onInput(text: string): void
  onResize(cols: number, rows: number): void
  onContextLoss?(): void
}

export function openTerminal(host: HTMLElement, options: TerminalOptions): TerminalView {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    scrollback: 5000,
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(host)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      options.onContextLoss?.()
      webgl.dispose()
    })
    term.loadAddon(webgl)
  } catch {
    // no WebGL: xterm keeps its DOM renderer
  }
  fitAddon.fit()
  term.onData((text) => options.onInput(text))
  term.onResize(({ cols, rows }) => options.onResize(cols, rows))

  return {
    term,
    write(bytes, done) {
      term.write(bytes, done)
    },
    reset() {
      term.write('\x1bc')
    },
    fit() {
      fitAddon.fit()
    },
    dispose() {
      term.dispose()
    },
  }
}
