import type { MenuAction } from '@shared/ipc'
import type { Feature, Project, Session } from '@shared/types'
import { fuzzy } from './fuzzy'
import { featureStage } from './featureLabels'
import { shownStatus } from './sessionStatus'

export interface PaletteItem {
  id: string
  kind: 'session' | 'feature' | 'project' | 'command'
  label: string
  detail: string
  hint?: string // a keyboard shortcut, for commands
  waiting?: boolean
  run: () => void
}

export interface PaletteActions {
  focusSession(id: string): void
  focusFeature(ref: { projectId: string; slug: string }): void
  openProject(id: string): void
  runAction(a: MenuAction): void
}

// App commands (design D3): static, run through the same `runAction` as the menu. Grid commands arrive with the grid.
export const PALETTE_COMMANDS: { id: string; label: string; hint?: string; action: MenuAction }[] = [
  { id: 'newSession', label: 'New session', hint: '⌘T', action: { type: 'newSession' } },
  { id: 'newTerminal', label: 'New terminal', hint: '⌘J', action: { type: 'newTerminal' } },
  { id: 'closeSession', label: 'Close session', hint: '⌘W', action: { type: 'closeSession' } },
  { id: 'sessionDiff', label: 'Session diff', hint: '⌥⌘B', action: { type: 'sessionDiff' } },
  { id: 'projectBoard', label: 'Project board', hint: '⌘B', action: { type: 'projectBoard' } },
]

const KIND_ORDER: Record<PaletteItem['kind'], number> = { session: 0, feature: 1, project: 2, command: 3 }
const DETAIL_PENALTY = 10 // a detail-only match ranks below any label match of similar quality

// Everything the palette can jump to, in the order it lists with an empty query.
export function paletteItems(
  data: { projects: Project[]; sessions: Session[]; features: Feature[] },
  actions: PaletteActions,
): PaletteItem[] {
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? id
  const sessions: PaletteItem[] = data.sessions.map((s) => {
    const status = shownStatus(s)
    return {
      id: `session:${s.id}`,
      kind: 'session',
      label: s.label,
      detail: `${projectName(s.projectId)} · ${s.kind} · ${status}`,
      waiting: status === 'waiting',
      run: () => actions.focusSession(s.id),
    }
  })
  const features: PaletteItem[] = data.features.map((f) => ({
    id: `feature:${f.projectId}/${f.slug}`,
    kind: 'feature',
    label: f.title,
    detail: `${projectName(f.projectId)} · ${featureStage(f)}`,
    run: () => actions.focusFeature({ projectId: f.projectId, slug: f.slug }),
  }))
  const projects: PaletteItem[] = data.projects.map((p) => ({
    id: `project:${p.id}`,
    kind: 'project',
    label: p.name,
    detail: p.path,
    run: () => actions.openProject(p.id),
  }))
  const commands: PaletteItem[] = PALETTE_COMMANDS.map((c) => ({
    id: `command:${c.id}`,
    kind: 'command',
    label: c.label,
    detail: 'command',
    hint: c.hint,
    run: () => actions.runAction(c.action),
  }))
  return [...sessions, ...features, ...projects, ...commands]
}

// Empty query: kind order, waiting sessions first. Otherwise best score first, ties by kind order, then list order.
export function rank(items: PaletteItem[], query: string): { item: PaletteItem; indices: number[] }[] {
  const q = query.trim()
  if (!q) {
    return items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || Number(!!b.item.waiting) - Number(!!a.item.waiting) || a.i - b.i)
      .map(({ item }) => ({ item, indices: [] }))
  }
  const scored: { item: PaletteItem; indices: number[]; score: number; i: number }[] = []
  items.forEach((item, i) => {
    const m = fuzzy(q, item.label)
    if (m) return void scored.push({ item, indices: m.indices, score: m.score, i })
    const d = fuzzy(q, item.detail)
    if (d) scored.push({ item, indices: [], score: d.score - DETAIL_PENALTY, i })
  })
  return scored
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.i - b.i)
    .map(({ item, indices }) => ({ item, indices }))
}
