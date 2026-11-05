import { describe, expect, it } from 'vitest'
import type { IntegrationInfo } from '../protocol/messages.ts'
import { promptView, rowView } from './integrations.ts'

const info = (patch: Partial<IntegrationInfo> = {}): IntegrationInfo => ({
  agent: 'claude',
  state: 'not-enabled',
  file: '/home/me/.claude/settings.json',
  backup: '/home/me/.claude/settings.json.grove-next.bak',
  pending: false,
  ...patch,
})

describe('rowView', () => {
  it('offers the actions each state allows, and never offers to change an unreadable file', () => {
    expect(rowView(info()).actions.map((action) => action.action)).toEqual(['enable'])
    expect(rowView(info({ state: 'enabled' })).actions.map((action) => action.action)).toEqual(['remove'])
    expect(rowView(info({ state: 'out-of-date' })).actions.map((action) => action.action)).toEqual(['update', 'remove'])
    expect(rowView(info({ state: 'unreadable', error: 'not a JSON object' })).actions).toEqual([])
  })

  it('names the state in words and shows the resolved file, the backup and the error', () => {
    const row = rowView(info({ state: 'unreadable', error: 'settings.json is not a JSON object' }))
    expect(row).toMatchObject({
      title: 'Claude',
      state: 'Settings unreadable',
      file: '/home/me/.claude/settings.json',
      backup: '/home/me/.claude/settings.json.grove-next.bak',
      error: 'settings.json is not a JSON object',
    })
    expect(rowView(info({ agent: 'copilot' })).title).toBe('Copilot')
  })
})

describe('promptView', () => {
  it('asks by name, and says what is written and where, the backup, and how to remove it', () => {
    const view = promptView(info({ agent: 'copilot', file: '/c/settings.json', backup: '/c/settings.json.grove-next.bak' }))
    const text = view.paragraphs.join('\n')
    expect(view.title).toBe('Enable status for Copilot?')
    expect(text).toContain('one hook command for each Copilot hook event to /c/settings.json')
    expect(text).toContain('copied to /c/settings.json.grove-next.bak')
    expect(text).toContain('grove-next integration uninstall copilot')
    expect(text).toContain('Agent status')
  })
})
