import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITerminalOptions, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TerminalView {
  term: Terminal
  write(bytes: Uint8Array, done?: () => void): void
  reset(): void
  fit(): void
  // Reads the colours from the tokens again, after the theme changed.
  restyle(): void
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

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

// The terminal's colours from the tokens: background, text, cursor, selection and the 16 ANSI colours.
function terminalTheme(): ITheme {
  const ansi = (prefix: string) => ANSI_NAMES.map((name) => tokenValue(`--ansi-${prefix}${name}`))
  const [black, red, green, yellow, blue, magenta, cyan, white] = ansi('')
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ansi('bright-')
  return {
    background: tokenValue('--color-ground'),
    foreground: tokenValue('--color-term-fg'),
    cursor: tokenValue('--color-ink'),
    selectionBackground: tokenValue('--color-selected'),
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
  }
}

// The terminal's colours, font and size from the tokens. xterm needs hex colours, which the tokens are.
function terminalOptions(): Pick<ITerminalOptions, 'theme' | 'fontFamily' | 'fontSize'> {
  return {
    theme: terminalTheme(),
    fontFamily: tokenValue('--font-mono'),
    fontSize: terminalFontSize(),
  }
}

export function openTerminal(host: HTMLElement, options: TerminalOptions): TerminalView {
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    // The fit addon reserves this width (0 counts as unset and gives a wide default) for the scrollbar, which styles.css hides.
    overviewRuler: { width: 1 },
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
    restyle() {
      term.options.theme = terminalTheme()
    },
    dispose() {
      term.dispose()
    },
  }
}
