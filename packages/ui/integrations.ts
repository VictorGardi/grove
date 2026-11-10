// Agent session setup: the Agents panel (the Claude hook's state, with Enable, Update and Remove) and the one-time prompt.
// The words and the actions are plain functions so they run in tests without a DOM; the controller is the DOM part.
import type { IntegrationAgent, IntegrationInfo, IntegrationState } from '../protocol/messages.ts'

const LABEL: Record<IntegrationAgent, string> = { claude: 'Claude' }
const STATE_TEXT: Record<IntegrationState, string> = {
  enabled: 'Enabled',
  'not-enabled': 'Not enabled',
  'out-of-date': 'Out of date',
  unreadable: 'Settings unreadable',
}

export type IntegrationAction = 'enable' | 'update' | 'remove'
const ACTIONS: Record<IntegrationState, IntegrationAction[]> = {
  enabled: ['remove'],
  'not-enabled': ['enable'],
  'out-of-date': ['update', 'remove'],
  // Grove never changes a file it cannot read, so there is nothing to offer.
  unreadable: [],
}
const ACTION_LABEL: Record<IntegrationAction, string> = { enable: 'Enable', update: 'Update', remove: 'Remove' }

export function integrationLabel(agent: IntegrationAgent): string {
  return LABEL[agent]
}

export interface IntegrationRow {
  agent: IntegrationAgent
  title: string
  state: string
  // What the state means for this agent, in one line.
  hint: string
  file: string
  backup: string
  error: string | null
  actions: Array<{ action: IntegrationAction; label: string }>
}

export function rowView(info: IntegrationInfo): IntegrationRow {
  const label = LABEL[info.agent]
  const hints: Record<IntegrationState, string> = {
    enabled: `${label} tells Grove its session id, so a tab you typed by hand, or one after /clear, resumes where it was.`,
    'not-enabled': `Without the hook, a ${label} tab you typed by hand, or one after /clear, may resume an older session.`,
    'out-of-date': `Grove has hooks from an older version. Update keeps only the session hook and keeps your own.`,
    unreadable: `Grove will not change this file until it can read it again.`,
  }
  return {
    agent: info.agent,
    title: label,
    state: STATE_TEXT[info.state],
    hint: hints[info.state],
    file: info.file,
    backup: info.backup,
    error: info.error ?? null,
    actions: ACTIONS[info.state].map((action) => ({ action, label: ACTION_LABEL[action] })),
  }
}

export interface PromptView {
  title: string
  paragraphs: string[]
}

// The question and what it means, in the words the human reads before saying yes. It names the file, the backup and the way out.
export function promptView(info: IntegrationInfo): PromptView {
  const label = LABEL[info.agent]
  return {
    title: `Enable session tracking for ${label}?`,
    paragraphs: [
      `Grove adds one hook command, for ${label}'s session start, to ${info.file}. The command does nothing unless it runs in a tab Grove opened or found, so other terminals are unaffected.`,
      `Your own hooks stay. The file is first copied to ${info.backup}, so you can put it back by hand.`,
      `Remove it any time under Agent status in the sidebar, or with grove integration uninstall ${info.agent}.`,
    ],
  }
}

export interface PanelElements {
  panel: HTMLElement
  list: HTMLElement
  error: HTMLElement
  close: HTMLButtonElement
  prompt: HTMLElement
  promptTitle: HTMLElement
  promptText: HTMLElement
  promptError: HTMLElement
  enable: HTMLButtonElement
  notNow: HTMLButtonElement
}

export interface PanelDeps {
  status(): Promise<IntegrationInfo[]>
  install(agent: IntegrationAgent): Promise<unknown>
  uninstall(agent: IntegrationAgent): Promise<unknown>
  answer(agent: IntegrationAgent): Promise<unknown>
}

export interface IntegrationPanel {
  open(): void
  // Shows the prompt for the agent if it is pending: running, no entry and no answer yet.
  ask(agent?: IntegrationAgent): Promise<void>
  isOpen(): boolean
}

function text(tag: string, value: string, className?: string): HTMLElement {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) element.className = className
  return element
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createIntegrationPanel(elements: PanelElements, deps: PanelDeps): IntegrationPanel {
  const { panel, list, error, close, prompt, promptTitle, promptText, promptError, enable, notNow } = elements
  let promptFor: IntegrationAgent | null = null

  function hidePanel(): void {
    panel.hidden = true
    error.hidden = true
  }

  function hidePrompt(): void {
    promptFor = null
    prompt.hidden = true
    promptError.hidden = true
    promptError.textContent = ''
  }

  async function render(): Promise<void> {
    const infos = await deps.status()
    list.replaceChildren(...infos.map((info) => rowElement(info)))
  }

  function rowElement(info: IntegrationInfo): HTMLElement {
    const row = rowView(info)
    const item = document.createElement('li')
    item.className = 'integration-row'
    const files = text('p', row.file, 'integration-file')
    const backup = text('p', `Backup: ${row.backup}`, 'integration-file')
    const buttons = row.actions.map(({ action, label }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => void act(row.agent, action, button))
      return button
    })
    item.append(
      text('h3', row.title, 'integration-name'),
      text('p', `${row.state}. ${row.hint}`, 'integration-state'),
      files,
      backup,
      ...(row.error ? [text('p', row.error, 'integration-error')] : []),
      ...buttons,
    )
    return item
  }

  async function act(agent: IntegrationAgent, action: IntegrationAction, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    try {
      if (action === 'remove') await deps.uninstall(agent)
      else await deps.install(agent)
      error.hidden = true
      await render()
    } catch (failure) {
      error.textContent = `Could not change ${LABEL[agent]}'s settings: ${message(failure)}`
      error.hidden = false
      button.disabled = false
    }
  }

  function showPrompt(info: IntegrationInfo): void {
    const view = promptView(info)
    promptFor = info.agent
    promptTitle.textContent = view.title
    promptText.replaceChildren(...view.paragraphs.map((paragraph) => text('p', paragraph)))
    promptError.hidden = true
    prompt.hidden = false
    enable.focus()
  }

  // Not now is recorded, and so is closing the prompt another way: either way it is not asked again by itself.
  async function declineIfOpen(): Promise<void> {
    const agent = promptFor
    if (agent === null) return
    hidePrompt()
    await deps.answer(agent).catch(() => undefined)
  }

  enable.addEventListener('click', async () => {
    const agent = promptFor
    if (agent === null) return
    try {
      await deps.install(agent)
      hidePrompt()
    } catch (failure) {
      promptError.textContent = `Could not enable ${LABEL[agent]}: ${message(failure)}`
      promptError.hidden = false
    }
  })
  notNow.addEventListener('click', () => void declineIfOpen())
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void declineIfOpen()
  })
  prompt.addEventListener('click', (event) => {
    if (event.target === prompt) void declineIfOpen()
  })
  close.addEventListener('click', hidePanel)
  panel.addEventListener('click', (event) => {
    if (event.target === panel) hidePanel()
  })
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePanel()
  })

  return {
    open() {
      panel.hidden = false
      close.focus()
      void render().catch((failure: unknown) => {
        error.textContent = `Could not read agent status: ${message(failure)}`
        error.hidden = false
      })
    },
    async ask(agent) {
      if (promptFor !== null || !prompt.hidden) return
      const infos = await deps.status()
      const pending = infos.find((info) => info.pending && (agent === undefined || info.agent === agent))
      if (pending) showPrompt(pending)
    },
    isOpen: () => !panel.hidden || !prompt.hidden,
  }
}
