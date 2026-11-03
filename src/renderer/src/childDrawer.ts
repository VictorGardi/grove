import type { Session } from '@shared/types'
import { asksHuman } from '@shared/attention'
import { shownStatus } from './sessionStatus'
import type { StatusTone } from './components/ui/StatusDot'

export type DrawerTab = 'all' | 'needs' | 'running' | 'done'
export type DrawerState = 'needs' | 'failed' | 'running' | 'done'

export const STATE_WORD: Record<DrawerState, string> = { needs: 'needs you', failed: 'failed', running: 'running', done: 'done' }

// One state per child: done, then asking the human, then failed, else running.
export function drawerState(kid: Session): DrawerState {
  if (kid.workflowStatus === 'done') return 'done'
  if (asksHuman(kid)) return 'needs'
  if (shownStatus(kid) === 'failed') return 'failed'
  return 'running'
}

// The dot of a child is its state, not its live pane: a done child is green whatever the pane says.
export const DOT_TONE: Record<DrawerState, StatusTone> = { done: 'working', running: 'finished', needs: 'waiting', failed: 'failed' }

// Which parent's drawer is open after a trigger (the sidebar bar or the header chip) is clicked:
// the same trigger again closes it, the other parent's trigger switches to it. At most one is open.
export const toggledDrawer = (open: string | null, parentId: string): string | null => (open === parentId ? null : parentId)

const ORDER: DrawerState[] = ['needs', 'failed', 'running', 'done']

const started = (s: Session) => {
  const t = Date.parse(s.startedAt)
  return Number.isNaN(t) ? -Infinity : t
}

// Needs you, failed, running, done; newest first inside each. A copy: the input is not touched.
export function orderDrawer(kids: Session[]): Session[] {
  return kids.map((k) => ({ k, r: ORDER.indexOf(drawerState(k)), t: started(k) }))
    .sort((a, b) => a.r - b.r || (a.t === b.t ? 0 : b.t > a.t ? 1 : -1))
    .map((x) => x.k)
}

const inTab = (kid: Session, tab: DrawerTab): boolean => {
  const st = drawerState(kid)
  return tab === 'all' || (tab === 'needs' ? st === 'needs' : tab === 'done' ? st === 'done' : st === 'running' || st === 'failed')
}

export function tabCounts(kids: Session[]): Record<DrawerTab, number> {
  const c: Record<DrawerTab, number> = { all: kids.length, needs: 0, running: 0, done: 0 }
  for (const k of kids) {
    const st = drawerState(k)
    if (st === 'needs') c.needs++
    else if (st === 'done') c.done++
    else c.running++
  }
  return c
}

export function filterDrawer(kids: Session[], tab: DrawerTab, query: string): Session[] {
  const q = query.trim().toLowerCase()
  return orderDrawer(kids.filter((k) => inTab(k, tab) && (!q || k.label.toLowerCase().includes(q))))
}
