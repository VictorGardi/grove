import type { Session } from '@shared/types'

// Live status for terminal sessions, from the command tmux says is in the foreground. A pane
// showing a shell is idle; anything else is working. A command that ran at least FINISH_MIN_MS
// and ended while the human was elsewhere reads as finished (waiting · done) until looked at.
export const FINISH_MIN_MS = 3000

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'login'])

export function isShell(command: string): boolean {
  return SHELLS.has(command.replace(/^-/, ''))
}

type Entry = { since: number | null; finished: boolean }

export interface TerminalActivity {
  // Feed one reading of every pane's foreground command. True when any visible status changed.
  observe(commands: Map<string, string>, terminals: Session[], now: number, onScreen: string | null): boolean
  seen(id: string | null): boolean
  apply(sessions: Session[]): Session[]
}

export function createTerminalActivity(): TerminalActivity {
  const entries = new Map<string, Entry>()
  const view = (e: Entry | undefined): Pick<Session, 'status' | 'waitingFor'> =>
    !e ? {} : e.since !== null ? { status: 'working' } : e.finished ? { status: 'waiting', waitingFor: 'done' } : { status: 'idle' }

  return {
    observe(commands, terminals, now, onScreen) {
      let changed = false
      const ids = new Set(terminals.map((s) => s.id))
      for (const id of entries.keys()) if (!ids.has(id)) { entries.delete(id); changed = true }
      for (const s of terminals) {
        const cmd = commands.get(s.tmuxName)
        if (cmd === undefined) continue // unreadable this tick: keep what we had
        const prev = entries.get(s.id)
        const e: Entry = { ...(prev ?? { since: null, finished: false }) }
        if (!isShell(cmd)) {
          e.since ??= now
          e.finished = false
        } else {
          if (e.since !== null && now - e.since >= FINISH_MIN_MS && s.id !== onScreen) e.finished = true
          e.since = null
        }
        if (s.id === onScreen) e.finished = false
        entries.set(s.id, e)
        if (!prev || (prev.since !== null) !== (e.since !== null) || prev.finished !== e.finished) changed = true
      }
      return changed
    },
    seen(id) {
      const e = id ? entries.get(id) : undefined
      if (!e?.finished) return false
      e.finished = false
      return true
    },
    apply(sessions) {
      let changed = false
      const out = sessions.map((s) => {
        if (s.kind !== 'terminal') return s
        const live = s.lastStatus === 'running' ? view(entries.get(s.id)) : {}
        if (live.status === s.status && live.waitingFor === s.waitingFor) return s
        changed = true
        const { status: _status, waitingFor: _waitingFor, ...rest } = s
        return { ...rest, ...live }
      })
      return changed ? out : sessions
    },
  }
}
