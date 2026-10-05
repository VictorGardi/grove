import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findTmux, loginShellArgv, minimalEnv } from './env'

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

describe('findTmux', () => {
  it.skipIf(!fs.existsSync('/opt/homebrew/bin/tmux'))('falls back to the fixed dirs', () => {
    expect(findTmux({ PATH: '/usr/bin:/bin' })).toBe('/opt/homebrew/bin/tmux')
  })

  it('returns null when nothing is found', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    expect(findTmux({ PATH: '' }, [empty])).toBeNull()
  })
})

describe('minimalEnv defaults', () => {
  it('appends the fixed dirs and sets a UTF-8 LANG', () => {
    const env = minimalEnv({ PATH: '/usr/bin:/bin' })
    expect(env.PATH!.endsWith(':/opt/homebrew/bin:/usr/local/bin')).toBe(true)
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('keeps LANG and does not duplicate dirs', () => {
    const env = minimalEnv({ PATH: '/opt/homebrew/bin:/usr/bin', LANG: 'sv_SE.UTF-8' })
    expect(env.LANG).toBe('sv_SE.UTF-8')
    expect(env.PATH!.split(':').filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1)
  })
})
