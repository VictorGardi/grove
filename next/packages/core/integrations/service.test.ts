import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARKER } from './install.ts'
import { IntegrationService } from './service.ts'

// Every file here lives under a temporary folder: the Claude settings, and the consent record.
describe('IntegrationService', () => {
  let dir: string
  let claude: string
  let consent: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-integration-'))
    claude = path.join(dir, 'claude', 'settings.json')
    consent = path.join(dir, 'home', 'integrations.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const service = () => new IntegrationService({ files: { claude }, consentFile: consent, node: '/usr/bin/node' })
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }

  it('reports a missing settings file as not enabled, and asks only for an agent that is running', () => {
    expect(service().status('claude', true)).toMatchObject({ state: 'not-enabled', file: claude, backup: `${claude}.grove-next.bak`, pending: true })
    expect(service().status('claude', false)).toMatchObject({ state: 'not-enabled', pending: false })
    expect(fs.existsSync(claude)).toBe(false)
  })

  it('writes nothing while it reads: status, pending and consent leave every file as it was', () => {
    service().status('claude', true)
    service().consent()
    expect(fs.existsSync(claude)).toBe(false)
    expect(fs.existsSync(consent)).toBe(false)
  })

  it('installs the Claude hook on a yes, enables the agent and stops asking', () => {
    const result = service().install('claude', true)
    expect(result).toMatchObject({ state: 'enabled', changed: true, written: null, pending: false })
    expect(fs.existsSync(claude)).toBe(true)
    expect(service().consent()).toEqual({ claude: 'enabled' })
    expect(service().status('claude', true).pending).toBe(false)
  })

  it('keeps the file as it was in a backup beside it, and keeps the user\'s own hooks', () => {
    write(claude, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })
    const original = fs.readFileSync(claude, 'utf8')
    const result = service().install('claude', false)
    expect(result).toMatchObject({ state: 'enabled', written: `${claude}.grove-next.bak` })
    expect(fs.readFileSync(`${claude}.grove-next.bak`, 'utf8')).toBe(original)
    const hooks = JSON.parse(fs.readFileSync(claude, 'utf8')).hooks
    expect(hooks.SessionStart.map((group: { hooks: Array<{ command: string }> }) => group.hooks[0].command)).toContain('echo mine')
  })

  it('removes only Grove\'s entries on uninstall, and does not ask again', () => {
    write(claude, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } })
    service().install('claude', true)
    const after = service().uninstall('claude', true)
    expect(after).toMatchObject({ state: 'not-enabled', pending: false })
    expect(JSON.parse(fs.readFileSync(claude, 'utf8'))).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } })
    expect(service().consent()).toEqual({ claude: 'enabled' })
  })

  it('shows an older install with status events as out of date, offers no prompt, and install brings it current', () => {
    write(claude, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `x ${MARKER}` }] }], Stop: [{ hooks: [{ type: 'command', command: `x ${MARKER}` }] }] } })
    expect(service().status('claude', true)).toMatchObject({ state: 'out-of-date', pending: false })
    expect(service().install('claude', true).state).toBe('enabled')
    expect(Object.keys(JSON.parse(fs.readFileSync(claude, 'utf8')).hooks)).toEqual(['SessionStart'])
  })

  it('refuses an unreadable file, never changes it, and says why', () => {
    write(claude, '[1, 2]')
    const before = fs.readFileSync(claude, 'utf8')
    expect(service().status('claude', true)).toMatchObject({ state: 'unreadable', pending: false })
    expect(service().status('claude', true).error).toContain('not a JSON object')
    expect(() => service().install('claude', true)).toThrow('not a JSON object')
    expect(fs.readFileSync(claude, 'utf8')).toBe(before)
    expect(service().consent()).toEqual({})
  })

  it('records not now, and keeps it across a restart: no prompt again, and the entry stays available', () => {
    service().answer('claude', 'not-now')
    expect(service().status('claude', true)).toMatchObject({ state: 'not-enabled', pending: false })
    expect(service().consent()).toEqual({ claude: 'not-now' })
    expect(service().install('claude', false).state).toBe('enabled')
  })
})
