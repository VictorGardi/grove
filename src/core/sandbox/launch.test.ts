import { describe, expect, it } from 'vitest'
import { newSession } from '../sessions'
import { sandboxArgvFor } from './launch'

describe('sandboxArgvFor', () => {
  it('refuses Copilot with the kind refusal, before looking at the host', async () => {
    const session = newSession({ projectId: 'p', kind: 'copilot', now: new Date(), id: 'a', agentSessionId: 'u' })
    const deps = { sandbox: { container: 'container', dockerfile: '/Dockerfile' }, sessionEnv: { socketPath: '/s', binDir: '/b' }, gitCommonDir: () => null }
    expect(await sandboxArgvFor({ kind: 'copilot', session, cwd: '/w', agentArgv: ['copilot'], deps })).toEqual({ refusal: 'kind' })
  })
})
