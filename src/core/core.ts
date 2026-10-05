import { randomUUID } from 'node:crypto'
import type { Project, Session, SessionKind, Slices, UiState } from '@shared/types'
import { DEFAULT_UI } from '@shared/types'
import type { Result } from '@shared/ipc'
import type { AttachHandle, SessionBackend } from './backend/types'
import { loginShellArgv } from './env'
import { newProject } from './projects'
import { newSession, reconcile } from './sessions'
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
  sessionCreate(a: { projectId: string; kind: SessionKind; cols: number; rows: number }): Promise<Result<Session>>
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

  const commands: Commands = {
    async projectAdd({ path }) {
      const project = newProject(path, randomUUID())
      set('projects', [...slices.projects, project])
      return { ok: true, data: project }
    },

    async sessionCreate({ projectId, kind, cols, rows }) {
      const project = slices.projects.find((p) => p.id === projectId)
      if (!project) return { ok: false, error: 'not-found' }
      const session = newSession({ projectId, kind, now: now(), id: randomUUID() })
      const argv = session.opencodeSessionId ? loginShellArgv(['opencode', '-s', session.opencodeSessionId]) : undefined
      await backend.create({ name: session.tmuxName, cwd: project.path, cols, rows, argv })
      set('sessions', [...slices.sessions, session])
      return { ok: true, data: session }
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
