import type { KeyValueStore } from './sidebar-state.ts'

export const APPEARANCE_KEY = 'grove-next.agent-appearance'

export const AGENT_APPEARANCE_SWATCHES = [
  { id: 'tile-1', label: 'Teal' },
  { id: 'tile-2', label: 'Orange' },
  { id: 'tile-3', label: 'Blue' },
  { id: 'tile-4', label: 'Violet' },
  { id: 'tile-5', label: 'Pink' },
  { id: 'tile-6', label: 'Gold' },
  { id: 'tile-7', label: 'Green' },
  { id: 'tile-8', label: 'Cyan' },
] as const

export type AgentAppearanceColor = (typeof AGENT_APPEARANCE_SWATCHES)[number]['id']
export type WorkingIndicatorStyle = 'dots' | 'waveform'

export interface AgentAppearance {
  needsYou: AgentAppearanceColor | null
  working: AgentAppearanceColor | null
  finished: AgentAppearanceColor | null
  workingIndicator: WorkingIndicatorStyle
}

export const DEFAULT_AGENT_APPEARANCE: AgentAppearance = {
  needsYou: null,
  working: null,
  finished: null,
  workingIndicator: 'dots',
}

const STATE_OVERRIDES = {
  needsYou: '--agent-state-needs-you',
  working: '--agent-state-working',
  finished: '--agent-state-finished',
} as const

function isColor(value: unknown): value is AgentAppearanceColor {
  return AGENT_APPEARANCE_SWATCHES.some(({ id }) => id === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAppearance(value: unknown): AgentAppearance | null {
  if (!isRecord(value)) return null
  const { needsYou, working, finished, workingIndicator } = value
  if (
    (needsYou !== null && !isColor(needsYou)) ||
    (working !== null && !isColor(working)) ||
    (finished !== null && !isColor(finished)) ||
    (workingIndicator !== 'dots' && workingIndicator !== 'waveform')
  ) {
    return null
  }
  return { needsYou, working, finished, workingIndicator }
}

export function readAgentAppearance(store: KeyValueStore | null): AgentAppearance {
  try {
    const stored = store?.getItem(APPEARANCE_KEY)
    if (stored === null || stored === undefined) return { ...DEFAULT_AGENT_APPEARANCE }
    return parseAppearance(JSON.parse(stored)) ?? { ...DEFAULT_AGENT_APPEARANCE }
  } catch {
    return { ...DEFAULT_AGENT_APPEARANCE }
  }
}

export function writeAgentAppearance(store: KeyValueStore | null, appearance: AgentAppearance): void {
  try {
    store?.setItem(APPEARANCE_KEY, JSON.stringify(appearance))
  } catch {
    // The preference still applies for this run when storage is unavailable.
  }
}

export function applyAgentAppearance(
  root: {
    dataset: DOMStringMap
    style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
  },
  appearance: AgentAppearance,
): void {
  for (const key of ['needsYou', 'working', 'finished'] as const) {
    const property = STATE_OVERRIDES[key]
    const color = appearance[key]
    if (color === null) root.style.removeProperty(property)
    else root.style.setProperty(property, `var(--${color})`)
  }
  root.dataset.workingIndicator = appearance.workingIndicator
}
