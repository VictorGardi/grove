// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationAgent, IntegrationInfo } from '../protocol/messages.ts'
import { createIntegrationPanel, type IntegrationPanel } from './integrations.ts'

const PAGE = `
  <div id="integrations-modal" class="modal-backdrop" hidden>
    <section><ul id="integrations-list"></ul><p id="integrations-error" hidden></p>
      <button id="integrations-close" type="button">Close</button></section>
  </div>
  <div id="integration-prompt" class="modal-backdrop" hidden>
    <section>
      <h2 id="integration-prompt-title"></h2><div id="integration-prompt-text"></div>
      <p id="integration-prompt-error" hidden></p>
      <button id="integration-not-now" type="button">Not now</button>
      <button id="integration-enable" type="button">Enable</button>
    </section>
  </div>`

const info = (agent: IntegrationAgent, patch: Partial<IntegrationInfo> = {}): IntegrationInfo => ({
  agent,
  state: 'not-enabled',
  file: `/cfg/${agent}/settings.json`,
  backup: `/cfg/${agent}/settings.json.grove.bak`,
  pending: true,
  ...patch,
})

describe('createIntegrationPanel', () => {
  let panel: IntegrationPanel
  let statuses: IntegrationInfo[]
  const deps = {
    status: vi.fn(async () => statuses),
    install: vi.fn(async (_agent: IntegrationAgent) => ({})),
    uninstall: vi.fn(async (_agent: IntegrationAgent) => ({})),
    answer: vi.fn(async (_agent: IntegrationAgent) => ({})),
  }
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

  beforeEach(() => {
    document.body.innerHTML = PAGE
    statuses = [info('claude')]
    deps.status.mockClear()
    deps.install.mockClear()
    deps.uninstall.mockClear()
    deps.answer.mockClear()
    panel = createIntegrationPanel(
      {
        panel: el('integrations-modal'),
        list: el('integrations-list'),
        error: el('integrations-error'),
        close: el<HTMLButtonElement>('integrations-close'),
        prompt: el('integration-prompt'),
        promptTitle: el('integration-prompt-title'),
        promptText: el('integration-prompt-text'),
        promptError: el('integration-prompt-error'),
        enable: el<HTMLButtonElement>('integration-enable'),
        notNow: el<HTMLButtonElement>('integration-not-now'),
      },
      deps,
    )
  })

  it('closes the settings on Esc wherever the focus is, but not when something inside took the key', () => {
    panel.open()
    expect(el('integrations-modal').hidden).toBe(false)
    // Focus on the body, as after a click on text in the modal.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(el('integrations-modal').hidden).toBe(true)

    panel.open()
    const taken = el('integrations-list')
    taken.addEventListener('keydown', (event) => event.stopPropagation())
    taken.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(el('integrations-modal').hidden).toBe(false)
  })

  it('asks once for a pending agent: the question names the file and the backup, and Not now is recorded', async () => {
    await panel.ask()
    expect(el('integration-prompt').hidden).toBe(false)
    expect(el('integration-prompt-title').textContent).toBe('Enable session tracking for Claude?')
    expect(el('integration-prompt-text').textContent).toContain('/cfg/claude/settings.json.grove.bak')

    el<HTMLButtonElement>('integration-not-now').click()
    await vi.waitFor(() => expect(deps.answer).toHaveBeenCalledWith('claude'))
    expect(el('integration-prompt').hidden).toBe(true)
    expect(deps.install).not.toHaveBeenCalled()
  })

  it('writes only on Enable, and closes the prompt after it worked', async () => {
    await panel.ask('claude')
    expect(deps.install).not.toHaveBeenCalled()
    el<HTMLButtonElement>('integration-enable').click()
    await vi.waitFor(() => expect(deps.install).toHaveBeenCalledWith('claude'))
    await vi.waitFor(() => expect(el('integration-prompt').hidden).toBe(true))
  })

  it('does not ask for an agent that is not pending', async () => {
    statuses = [info('claude', { pending: false })]
    await panel.ask('claude')
    expect(el('integration-prompt').hidden).toBe(true)
  })

  it('lists the Claude hook in the Agents panel, with Update and Remove when out of date', async () => {
    statuses = [info('claude', { state: 'out-of-date', pending: false })]
    panel.open()
    await vi.waitFor(() => expect(el('integrations-list').querySelectorAll('li').length).toBe(1))
    const rows = [...el('integrations-list').querySelectorAll('li')]
    expect(rows[0].textContent).toContain('Out of date')
    expect([...rows[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Update', 'Remove'])
    expect(panel.isOpen()).toBe(true)
  })
})
