import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaude, createOpenCode, createTerminal, setupCore } from './testing/setup'

const sessionEnv = { socketPath: '/s.sock', binDir: '/bin' }

describe('GROVE_* session env', () => {
  const t = setupCore()
  afterEach(() => {
    vi.unstubAllEnvs()
    t.disposeAll()
  })

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
      OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"},"theme":{"name":"tokyonight","mode":"dark"}}', // unchanged by the move into shared/opencodeSession: this exact string is what the pane has always got
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

  const withModel = async () => {
    const core = t.make(undefined, { sessionEnv })
    await core.start()
    const res = await core.commands.sessionCreate({ projectId: 'p', kind: 'opencode', model: 'p/m1', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    return res.data
  }

  it('an opencode session with a model gets it beside the ids and the chrome', async () => {
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', '')
    const s = await withModel()
    expect(created().env).toEqual({
      GROVE_SESSION_ID: s.id,
      GROVE_SOCKET: '/s.sock',
      OPENCODE_CLI_CONFIG_CONTENT: expect.any(String),
      OPENCODE_CONFIG_CONTENT: '{"model":"p/m1"}',
    })
  })

  it('merges the model into an inherited OPENCODE_CONFIG_CONTENT', async () => {
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', '{"permission":{"x":1}}')
    await withModel()
    expect(JSON.parse(created().env!.OPENCODE_CONFIG_CONTENT!)).toEqual({ permission: { x: 1 }, model: 'p/m1' })
  })
})
