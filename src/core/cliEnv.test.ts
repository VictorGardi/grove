import { afterEach, describe, expect, it } from 'vitest'
import { createClaude, createOpenCode, createTerminal, setupCore } from './testing/setup'

const sessionEnv = { socketPath: '/s.sock', binDir: '/bin' }

describe('GROVE_* session env', () => {
  const t = setupCore()
  afterEach(() => t.disposeAll())

  const created = () => t.fake.calls.filter((c) => c.method === 'create').at(-1)!.args[0] as {
    env?: Record<string, string>
    argv?: string[]
  }

  it('terminal sessions get the id, the socket and PATH', async () => {
    const core = t.make(undefined, { sessionEnv })
    await core.start()
    const s = await createTerminal(core)
    const env = created().env!
    expect(env.GROVE_SESSION_ID).toBe(s.id)
    expect(env.GROVE_SOCKET).toBe('/s.sock')
    expect(env.PATH!.startsWith('/bin:')).toBe(true)
  })

  it('agent sessions get the ids, and PATH is prefixed after the rc files', async () => {
    const core = t.make(undefined, { sessionEnv })
    await core.start()
    const s = await createOpenCode(core)
    expect(created().env).toEqual({
      GROVE_SESSION_ID: s.id,
      GROVE_SOCKET: '/s.sock',
      OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"},"theme":{"name":"tokyonight","mode":"dark"}}',
    })
    expect(created().argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec /)
    await createClaude(core)
    expect(created().env).toEqual({ GROVE_SESSION_ID: expect.any(String), GROVE_SOCKET: '/s.sock' })
    expect(created().argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec /)
  })

  it('passes no env without sessionEnv', async () => {
    const core = t.make()
    await core.start()
    await createTerminal(core)
    expect(created().env).toBeUndefined()
  })
})
