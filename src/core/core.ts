import { randomUUID } from 'node:crypto'
import type { Project, Session, SessionKind, Slices, UiState } from '@shared/types'
import { DEFAULT_UI } from '@shared/types'
import type { Result } from '@shared/ipc'
import type { AttachHandle, SessionBackend } from './backend/types'
import { terminalTheme } from '@shared/theme'
import { loginShellArgv } from './env'
import { hasLiveSessions, newProject } from './projects'
import { markGone, newSession, reconcile, rename } from './sessions'
import { loadConfig, saveConfig } from './store/configStore'
import { loadState, saveState } from './store/stateStore'

export interface CoreOptions {
  configPath: string // ~/.config/grove/config.json
  statePath: string // <userData>/state.json
  backend: SessionBackend
  now?: () => Date // tests inject this
}

type SliceListener = <K extends keyof Slices>(k: K, v: Slices[K]) => void

export interface Commands {
  projectAdd(a: { path: string }): Promise<Result<Project>>
  projectRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionCreate(a: { projectId: string; kind: SessionKind; cols: number; rows: number }): Promise<Result<Session>>
  sessionKill(a: { id: string }): Promise<Result<{ id: string }>>
  sessionRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionRename(a: { id: string; label: string }): Promise<Result<Session>>
  uiSet(partial: Partial<UiState>): Promise<Result<UiState>>
}

export interface Core {
  start(): Promise<void>
  getSlices(): Slices
  getErrors(): string[]
  on(e: 'slice', cb: SliceListener): () => void
  checkLiveness(): Promise<void>
  commands: Commands
  attach(sessionId: string, cols: number, rows: number): AttachHandle
  dispose(): void
}

export function createCore(opts: CoreOptions): Core {
  const { backend } = opts
  const now = opts.now ?? (() => new Date())
  const slices: Slices = { projects: [], sessions: [], ui: DEFAULT_UI }
  const errors: string[] = []
  const listeners = new Set<SliceListener>()
  const handles = new Set<AttachHandle>()
  let poll: ReturnType<typeof setInterval> | undefined

  function set<K extends keyof Slices>(k: K, v: Slices[K]): void {
    slices[k] = v
    for (const l of listeners) l(k, v)
    if (k === 'projects') saveConfig(opts.configPath, { schemaVersion: 1, projects: slices.projects })
    else saveState(opts.statePath, { schemaVersion: 1, sessions: slices.sessions, ui: slices.ui })
  }

  async function checkLiveness(): Promise<void> {
    let live: Set<string>
    try {
      live = await backend.list()
    } catch {
      return // transient tmux errors are retried by the next poll
    }
    const next = reconcile(slices.sessions, live, now().toISOString())
    if (next !== slices.sessions) set('sessions', next)
  }

  const findSession = (id: string) => slices.sessions.find((s) => s.id === id)

  function replaceSession(next: Session): void {
    set('sessions', slices.sessions.map((s) => (s.id === next.id ? next : s)))
  }

  function dropSessions(keep: (s: Session) => boolean): void {
    const focused = slices.ui.focusedSessionId
    set('sessions', slices.sessions.filter(keep))
    if (focused && !findSession(focused)) set('ui', { ...slices.ui, focusedSessionId: null })
  }

  const commands: Commands = {
    async projectAdd({ path }) {
      const project = newProject(path, randomUUID())
      set('projects', [...slices.projects, project])
      return { ok: true, data: project }
    },

    async projectRemove({ id }) {
      if (!slices.projects.some((p) => p.id === id)) return { ok: false, error: 'not-found' }
      if (hasLiveSessions(id, slices.sessions)) return { ok: false, error: 'has-live-sessions' }
      set('projects', slices.projects.filter((p) => p.id !== id))
      dropSessions((s) => s.projectId !== id)
      return { ok: true, data: { id } }
    },

    async sessionCreate({ projectId, kind, cols, rows }) {
      const project = slices.projects.find((p) => p.id === projectId)
      if (!project) return { ok: false, error: 'not-found' }
      const session = newSession({ projectId, kind, now: now(), id: randomUUID() })
      const argv = session.opencodeSessionId ? loginShellArgv(['opencode', '-s', session.opencodeSessionId]) : undefined
      await backend.create({ name: session.tmuxName, cwd: project.path, cols, rows, argv })
      await backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)
      set('sessions', [...slices.sessions, session])
      return { ok: true, data: session }
    },

    async sessionKill({ id }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      await backend.kill(session.tmuxName) // already-missing counts as success
      // re-read: a poll may have flipped it while kill was in flight
      replaceSession(markGone(findSession(id) ?? session, now().toISOString()))
      return { ok: true, data: { id } }
    },

    async sessionRemove({ id }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      if (session.lastStatus !== 'gone') return { ok: false, error: 'not-gone' }
      dropSessions((s) => s.id !== id)
      return { ok: true, data: { id } }
    },

    async sessionRename({ id, label }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      const next = rename(session, label)
      replaceSession(next)
      return { ok: true, data: next }
    },

    async uiSet(partial) {
      set('ui', { ...slices.ui, ...partial })
      return { ok: true, data: slices.ui }
    },
  }

  return {
    async start() {
      const onBad = (m: string) => errors.push(m)
      slices.projects = loadConfig(opts.configPath, onBad).projects
      const state = loadState(opts.statePath, onBad)
      slices.sessions = state.sessions
      slices.ui = state.ui
      try {
        await backend.ensureConfig()
        const next = reconcile(slices.sessions, await backend.list(), now().toISOString())
        if (next !== slices.sessions) set('sessions', next)
      } catch (e) {
        errors.push(`tmux: ${(e as Error).message}`)
      }
      poll = setInterval(() => void checkLiveness(), 5000)
    },
    getSlices: () => slices,
    getErrors: () => [...errors],
    on(_e, cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    checkLiveness,
    commands,
    attach(sessionId, cols, rows) {
      const session = slices.sessions.find((s) => s.id === sessionId)
      if (!session) throw new Error('not-found')
      const h = backend.attach(session.tmuxName, cols, rows)
      const tracked: AttachHandle = {
        ...h,
        kill: () => {
          handles.delete(tracked)
          h.kill()
        },
      }
      handles.add(tracked)
      h.onExit(() => {
        handles.delete(tracked)
        void checkLiveness()
      })
      return tracked
    },
    dispose() {
      clearInterval(poll)
      for (const h of [...handles]) h.kill()
    },
  }
}
