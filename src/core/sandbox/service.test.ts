import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureServiceReachable, servicePassword } from './service'

const temps: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-service-'))
  temps.push(d)
  return d
}
afterEach(() => temps.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

// `container network ls --format json`, exactly as 1.5.0 prints it: an array whose element carries
// the name under `configuration` and the address under `status`. A network on another subnet yields
// another gateway, which is why grove reads this and never assumes `.1`.
const NETWORKS = (gateway: string | null): string =>
  JSON.stringify(
    gateway ? [{ configuration: { name: 'default' }, status: { ipv4Gateway: gateway, ipv4Subnet: '192.168.64.0/24' } }] : [],
  )

// A `container` that records every invocation and answers `network ls` with `replies` in order,
// repeating the last one once they run out. The real binary is never touched: it is this machine's
// live sandbox system, and starting it would start the kernel.
const fakeContainer = (replies: string[], startExit = 0): { file: string; log: () => string[] } => {
  const dir = tmp()
  const file = path.join(dir, 'container')
  const log = path.join(dir, 'log')
  const count = path.join(dir, 'count')
  const cases = replies.map((r, i) => `    ${i}) printf '%s\\n' ${JSON.stringify(r)} ;;`).join('\n')
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      `echo "$@" >> ${log}`,
      'if [ "$1 $2" = "system start" ]; then exit ' + startExit + '; fi',
      'if [ "$1 $2" = "network ls" ]; then',
      `  n=$(cat ${count} 2>/dev/null || echo 0)`,
      `  echo $((n + 1)) > ${count}`,
      '  case "$n" in',
      cases,
      '  esac',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  return { file, log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) }
}

// No waiting: the backoff is measured by the clock, not here.
const FAST = { attempts: 4, firstDelayMs: 0, maxDelayMs: 0 }
const REACH = (file: string, o: Partial<Parameters<typeof ensureServiceReachable>[0]> = {}) =>
  ensureServiceReachable({ configFile: file, container: fakeContainer([NETWORKS('192.168.64.1')]).file, ...FAST, ...o })
const configFile = (contents?: string): string => {
  const file = path.join(tmp(), 'opencode', 'service.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (contents !== undefined) fs.writeFileSync(file, contents)
  return file
}
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

describe('ensureServiceReachable', () => {
  it('starts the container system and writes the gateway it discovers', async () => {
    const file = configFile('{}')
    const { file: bin, log } = fakeContainer([NETWORKS('192.168.64.1')])
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(log()).toEqual(['system start', 'network ls --format json'])
    expect(read(file)).toEqual({ hostname: '192.168.64.1' })
  })

  // The design: "writes the bind address **once**". Every sandboxed session afterwards spawns
  // nothing at all — not even to re-read a value it already knows.
  it('spawns nothing when the bind is already there, and leaves the file byte-identical', async () => {
    const file = configFile('{"hostname":"192.168.64.1"}')
    const before = fs.readFileSync(file, 'utf8')
    const { file: bin, log } = fakeContainer([NETWORKS('192.168.64.1')])
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(log()).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })

  // The service writes its own `password` back into this file, so a write that dropped the rest
  // would break the service it was meant to make reachable.
  it('keeps every other key the config already carries', async () => {
    const file = configFile('{"port":49561,"password":"s3cret"}')
    await REACH(file)
    expect(read(file)).toEqual({ port: 49561, password: 's3cret', hostname: '192.168.64.1' })
  })

  it('creates a config that is not there, readable by its owner only', async () => {
    const file = configFile()
    await REACH(file)
    expect(read(file)).toEqual({ hostname: '192.168.64.1' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  // `bridge100` is created by `container system start`, measured 2m24s after login: the first
  // sessions of the morning find no gateway at all.
  it('polls until a gateway appears', async () => {
    const file = configFile('{}')
    const { file: bin, log } = fakeContainer([NETWORKS(null), NETWORKS(null), NETWORKS('192.168.64.1')])
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(log()).toEqual(['system start', 'network ls --format json', 'network ls --format json', 'network ls --format json'])
    expect(read(file)).toEqual({ hostname: '192.168.64.1' })
  })

  // Never `0.0.0.0` — measured to expose the service on the LAN — and never a loopback address,
  // which inside the container is the container itself. Neither is a bind; both keep the retry going.
  it('never binds a wildcard or a loopback address', async () => {
    for (const bad of ['0.0.0.0', '*', '127.0.0.1']) {
      const file = configFile('{"port":49561}')
      await expect(REACH(file, { container: fakeContainer([NETWORKS(bad)]).file })).rejects.toThrow()
      expect(read(file)).toEqual({ port: 49561 }) // untouched
    }
  })

  it('refuses once the budget is spent', async () => {
    const file = configFile('{}')
    await expect(REACH(file, { container: fakeContainer([NETWORKS(null)]).file })).rejects.toThrow()
  })

  it('stops retrying after the first usable gateway', async () => {
    const file = configFile('{}')
    const { file: bin, log } = fakeContainer([NETWORKS('192.168.64.1')])
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(log().filter((c) => c.startsWith('network'))).toHaveLength(1)
  })

  // `system start` is idempotent, and on a system already up it can still exit non-zero. What
  // decides the bind is whether a gateway can be discovered, not whether the start was clean.
  it('discovers the gateway even when `system start` fails', async () => {
    const file = configFile('{}')
    const { file: bin, log } = fakeContainer([NETWORKS('192.168.64.1')], 1)
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(log()).toEqual(['system start', 'network ls --format json'])
    expect(read(file)).toEqual({ hostname: '192.168.64.1' })
  })

  it('refuses, rather than throwing something else, when there is no `container` at all', async () => {
    await expect(REACH(configFile('{}'), { container: path.join(tmp(), 'absent') })).rejects.toThrow()
  })

  it('finds the `default` network and not whichever answers first', async () => {
    const file = configFile('{}')
    const two = JSON.stringify([
      { configuration: { name: 'other' }, status: { ipv4Gateway: '10.99.0.1' } },
      { configuration: { name: 'default' }, status: { ipv4Gateway: '192.168.64.1' } },
    ])
    const { file: bin } = fakeContainer([two])
    await ensureServiceReachable({ configFile: file, container: bin, ...FAST })
    expect(read(file)).toEqual({ hostname: '192.168.64.1' })
  })

  // The registration file is the host's, and grove reads it and never writes it — a second
  // registration evicts the incumbent, which is the whole hazard D6 exists to remove.
  it('never writes to a file it was not given', async () => {
    const dir = tmp()
    const registration = path.join(dir, 'service.json')
    fs.writeFileSync(registration, '{"url":"http://127.0.0.1:49374","password":"s3cret"}')
    const before = fs.readFileSync(registration, 'utf8')
    const { file: bin, log } = fakeContainer([NETWORKS('192.168.64.1')])
    await ensureServiceReachable({ configFile: path.join(dir, 'config.json'), container: bin, ...FAST })
    expect(fs.readFileSync(registration, 'utf8')).toBe(before)
    expect(log().join(' ')).not.toContain(registration)
  })
})

describe('servicePassword', () => {
  // The container gets 401 without it: the agent reads the address from the registration but takes
  // the credential from the environment, so grove has to hand it over.
  it('is the registration file’s password', () => {
    const file = path.join(tmp(), 'service.json')
    fs.writeFileSync(file, '{"url":"http://192.168.64.1:49374","pid":1075,"password":"s3cret"}')
    expect(servicePassword(file)).toBe('s3cret')
  })

  it('is undefined, never a throw, for a file that is not there or is not one', () => {
    const dir = tmp()
    expect(servicePassword(path.join(dir, 'absent.json'))).toBeUndefined()
    const broken = path.join(dir, 'broken.json')
    fs.writeFileSync(broken, 'not json')
    expect(servicePassword(broken)).toBeUndefined()
    const nokey = path.join(dir, 'nokey.json')
    fs.writeFileSync(nokey, '{"url":"http://127.0.0.1:49374"}')
    expect(servicePassword(nokey)).toBeUndefined()
  })
})