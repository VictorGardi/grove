import { describe, expect, it } from 'vitest'
import { loginShellArgv, minimalEnv } from './env'

describe('loginShellArgv', () => {
  it('wraps argv in a login interactive shell', () => {
    expect(loginShellArgv(['opencode', '-s', 'ses_abc'], '/bin/zsh')).toEqual([
      '/bin/zsh', '-l', '-i', '-c', 'exec opencode -s ses_abc',
    ])
  })

  it('single-quotes arguments with spaces or quotes', () => {
    expect(loginShellArgv(['echo', "a b'c"], '/bin/zsh')[4]).toBe("exec echo 'a b'\\''c'")
  })
})

describe('minimalEnv', () => {
  it('strips tmux vars and keeps the rest', () => {
    const env = minimalEnv({ TMUX: 'x', TMUX_PANE: '%1', HOME: '/h', PATH: '/usr/bin' })
    expect(env.TMUX).toBeUndefined()
    expect(env.TMUX_PANE).toBeUndefined()
    expect(env.HOME).toBe('/h')
  })
})
