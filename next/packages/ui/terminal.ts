import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
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

// The value of a design token on the root, trimmed. Tokens are the only source of the terminal's colours and font.
export function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// --text-terminal as a number: the token holds a length in pixels, and the number is that count.
export function terminalFontSize(): number {
  return Number.parseFloat(tokenValue('--text-terminal'))
}

// The terminal's colours, font and size from the tokens. xterm needs hex colours, which the tokens are.
function terminalOptions(): Pick<ITerminalOptions, 'theme' | 'fontFamily' | 'fontSize'> {
  return {
    theme: {
      background: tokenValue('--color-ground'),
      foreground: tokenValue('--color-term-fg'),
      cursor: tokenValue('--color-ink'),
      selectionBackground: tokenValue('--color-selected'),
    },
    fontFamily: tokenValue('--font-mono'),
    fontSize: terminalFontSize(),
  }
}

export function openTerminal(host: HTMLElement, options: TerminalOptions): TerminalView {
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    ...terminalOptions(),
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
