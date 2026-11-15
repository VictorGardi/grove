import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentAdapter } from './adapter.ts'
import { StatusService } from './service.ts'

describe('StatusService session names', () => {
  let home: string
  let names: Map<string, (name: string) => void>
  const adapter = (): AgentAdapter => ({
    kind: 'claude',
    launch: () => {
      throw new Error('not used')
    },
    watch: (input) => {
      if (input.onName) names.set(input.tabId, input.onName)
      return { close: () => names.delete(input.tabId) }
    },
  })
  const make = () =>
    new StatusService({ home, adapters: { claude: adapter() }, reports: () => new Map(), alive: async () => new Set(['t1']), onSession: () => {}, clock: () => 1 })
  const track = (service: StatusService) => service.track({ tabId: 't1', spaceId: home, spacePath: home, kind: 'claude', sessionId: 's1' })
  const nameOf = (service: StatusService) => service.list(new Set(['t1'])).find((agent) => agent.tabId === 't1')?.name

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-service-name-'))
    names = new Map()
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  it('lists no name until the agent gives one, then the latest', () => {
    const service = make()
    track(service)
    expect(nameOf(service)).toBeUndefined()
    names.get('t1')!('first')
    names.get('t1')!('second')
    expect(nameOf(service)).toBe('second')
    service.close()
  })

  it('tells listeners about a name once per change, never about a repeat', () => {
    const service = make()
    const heard: Array<[string, string]> = []
    service.subscribeName((tabId, name) => heard.push([tabId, name]))
    track(service)
    names.get('t1')!('a')
    names.get('t1')!('a')
    names.get('t1')!('b')
    expect(heard).toEqual([['t1', 'a'], ['t1', 'b']])
    service.close()
  })

  it('lists the session id the tab runs, which the name belongs to', () => {
    const service = make()
    track(service)
    expect(service.list(new Set(['t1'])).find((agent) => agent.tabId === 't1')?.sessionId).toBe('s1')
    service.close()
  })

  it('stops a listener that unsubscribed', () => {
    const service = make()
    const heard: string[] = []
    const stop = service.subscribeName((_tabId, name) => heard.push(name))
    track(service)
    stop()
    names.get('t1')!('a')
    expect(heard).toEqual([])
    service.close()
  })

  it('drops a name delivered after the tab was untracked', () => {
    const service = make()
    track(service)
    const deliver = names.get('t1')!
    service.untrack('t1')
    deliver('late')
    expect(nameOf(service)).toBeUndefined()
    service.close()
  })
})
