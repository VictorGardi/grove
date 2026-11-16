// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillAgentInfo } from '../protocol/messages.ts'
import { createSkillsPanel, skillRowView } from './skills-panel.ts'

const info = (agent: SkillAgentInfo['agent'], patch: Partial<SkillAgentInfo> = {}): SkillAgentInfo => ({
  agent,
  state: 'not-installed',
  dir: `/home/${agent}/skills`,
  ...patch,
})

describe('skillRowView', () => {
  it('offers what the state allows, and nothing when blocked', () => {
    expect(skillRowView(info('claude')).actions).toEqual([{ action: 'install', label: 'Install' }])
    expect(skillRowView(info('claude', { state: 'installed' })).actions.map((a) => a.action)).toEqual(['remove'])
    expect(skillRowView(info('claude', { state: 'out-of-date' })).actions.map((a) => a.action)).toEqual(['update', 'remove'])
    expect(skillRowView(info('claude', { state: 'blocked', error: 'x' })).actions).toEqual([])
  })
})

describe('createSkillsPanel', () => {
  let statuses: SkillAgentInfo[]
  const deps = {
    status: vi.fn(async () => statuses),
    install: vi.fn(async (_agent: string) => ({})),
    uninstall: vi.fn(async (_agent: string) => ({})),
  }
  const list = () => document.getElementById('skills-list')!
  const error = () => document.getElementById('skills-error')!

  beforeEach(() => {
    document.body.innerHTML = '<ul id="skills-list"></ul><p id="skills-error" hidden></p>'
    statuses = [info('claude'), info('copilot', { state: 'installed' }), info('opencode')]
    deps.install.mockClear()
    deps.uninstall.mockClear()
  })

  it('lists one row per agent with its folder', async () => {
    await createSkillsPanel({ list: list(), error: error() }, deps).refresh()
    expect(list().children).toHaveLength(3)
    expect(list().textContent).toContain('/home/opencode/skills')
    expect(list().children[1]!.textContent).toContain('Installed')
  })

  it('installs for the agent whose button is pressed, then reads again', async () => {
    await createSkillsPanel({ list: list(), error: error() }, deps).refresh()
    statuses = [info('claude', { state: 'installed' }), info('copilot', { state: 'installed' }), info('opencode')]
    list().children[0]!.querySelector('button')!.click()
    await vi.waitFor(() => expect(list().children[0]!.textContent).toContain('Installed'))
    expect(deps.install).toHaveBeenCalledWith('claude')
  })

  it('shows a refusal and keeps the row', async () => {
    deps.install.mockRejectedValueOnce(new Error('/x/SKILL.md exists and was not written by grove'))
    await createSkillsPanel({ list: list(), error: error() }, deps).refresh()
    list().children[0]!.querySelector('button')!.click()
    await vi.waitFor(() => expect(error().hidden).toBe(false))
    expect(error().textContent).toContain('not written by grove')
    expect(list().children[0]!.textContent).toContain('Not installed')
  })
})
