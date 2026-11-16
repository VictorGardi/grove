// Agent skills in the settings: one row per agent, with Install, Update and Remove for Grove's skills in its user skill folder.
// The words are plain functions so they run in tests without a DOM; the controller is the DOM part.
import type { SkillAgent, SkillAgentInfo, SkillState } from '../protocol/messages.ts'

const LABEL: Record<SkillAgent, string> = { claude: 'Claude', copilot: 'Copilot', opencode: 'OpenCode' }
const STATE_TEXT: Record<SkillState, string> = {
  installed: 'Installed',
  'not-installed': 'Not installed',
  'out-of-date': 'Out of date',
  blocked: 'Blocked',
}

export type SkillAction = 'install' | 'update' | 'remove'
const ACTIONS: Record<SkillState, SkillAction[]> = {
  installed: ['remove'],
  'not-installed': ['install'],
  'out-of-date': ['update', 'remove'],
  // Grove never replaces a file it did not write, so there is nothing to offer.
  blocked: [],
}
const ACTION_LABEL: Record<SkillAction, string> = { install: 'Install', update: 'Update', remove: 'Remove' }

export interface SkillRow {
  agent: SkillAgent
  title: string
  state: string
  dir: string
  error: string | null
  actions: Array<{ action: SkillAction; label: string }>
}

export function skillRowView(info: SkillAgentInfo): SkillRow {
  return {
    agent: info.agent,
    title: LABEL[info.agent],
    state: STATE_TEXT[info.state],
    dir: info.dir,
    error: info.error ?? null,
    actions: ACTIONS[info.state].map((action) => ({ action, label: ACTION_LABEL[action] })),
  }
}

export interface SkillsElements {
  list: HTMLElement
  error: HTMLElement
}

export interface SkillsDeps {
  status(): Promise<SkillAgentInfo[]>
  install(agent: SkillAgent): Promise<unknown>
  uninstall(agent: SkillAgent): Promise<unknown>
}

export interface SkillsPanel {
  refresh(): Promise<void>
}

function text(tag: string, value: string, className?: string): HTMLElement {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) element.className = className
  return element
}

const message = (value: unknown): string => (value instanceof Error ? value.message : String(value))

export function createSkillsPanel({ list, error }: SkillsElements, deps: SkillsDeps): SkillsPanel {
  async function refresh(): Promise<void> {
    try {
      const infos = await deps.status()
      list.replaceChildren(...infos.map(rowElement))
    } catch (failure) {
      show(`Could not read the skill folders: ${message(failure)}`)
    }
  }

  function show(value: string | null): void {
    error.textContent = value ?? ''
    error.hidden = value === null
  }

  function rowElement(info: SkillAgentInfo): HTMLElement {
    const row = skillRowView(info)
    const item = document.createElement('li')
    item.className = 'integration-row'
    const buttons = row.actions.map(({ action, label }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => void act(row, action, button))
      return button
    })
    item.append(
      text('h3', row.title, 'integration-name'),
      text('p', row.state, 'integration-state'),
      text('p', row.dir, 'integration-file'),
      ...(row.error ? [text('p', row.error, 'integration-error')] : []),
      ...buttons,
    )
    return item
  }

  async function act(row: SkillRow, action: SkillAction, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    try {
      if (action === 'remove') await deps.uninstall(row.agent)
      else await deps.install(row.agent)
      show(null)
    } catch (failure) {
      show(`Could not change ${row.title}'s skills: ${message(failure)}`)
    }
    await refresh()
  }

  return { refresh }
}
