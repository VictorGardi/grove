import { randomUUID } from 'node:crypto'
import type { Project, Session, SessionKind, Slices } from '@shared/types'
import { DEFAULT_UI } from '@shared/types'
import type { Result } from '@shared/ipc'
import type { AttachHandle, SessionBackend } from './backend/types'
import { newProject } from './projects'
import { newSession } from './sessions'
import { loadConfig, saveConfig } from './store/configStore'

export interface CoreOptions {
  configPath: string // ~/.config/grove/config.json
  statePath: string // <userData>/state.json (used from slice 2)
  backend: SessionBackend
  now?: () => Date // tests inject this
}

type SliceListener = <K extends keyof Slices>(k: K, v: Slices[K]) => void

export interface Commands {
  projectAdd(a: { path: string }): Promise<Result<Project>>
  sessionCreate(a: { projectId: string; kind: SessionKind; cols: number; rows: number }): Promise<Result<Session>>
}

export interface Core {
  start(): Promise<void>
  getSlices(): Slices
  getErrors(): string[]
  on(e: 'slice', cb: SliceListener): () => void
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

  function set<K extends keyof Slices>(k: K, v: Slices[K]): void {
    slices[k] = v
    for (const l of listeners) l(k, v)
  }

  const commands: Commands = {
    async projectAdd({ path }) {
      const project = newProject(path, randomUUID())
      set('projects', [...slices.projects, project])
      saveConfig(opts.configPath, { schemaVersion: 1, projects: slices.projects })
      return { ok: true, data: project }
    },

    async sessionCreate({ projectId, kind, cols, rows }) {
      if (kind !== 'terminal') return { ok: false, error: 'unsupported-kind' }
      const project = slices.projects.find((p) => p.id === projectId)
      if (!project) return { ok: false, error: 'not-found' }
      const session = newSession({ projectId, kind, now: now(), id: randomUUID() })
      await backend.create({ name: session.tmuxName, cwd: project.path, cols, rows })
      set('sessions', [...slices.sessions, session])
      return { ok: true, data: session }
    },
  }

  return {
    async start() {
      const cfg = loadConfig(opts.configPath, (m) => errors.push(m))
      slices.projects = cfg.projects
      try {
        await backend.ensureConfig()
      } catch (e) {
        errors.push(`tmux: ${(e as Error).message}`)
      }
    },
    getSlices: () => slices,
    getErrors: () => [...errors],
    on(_e, cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
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
      h.onExit(() => handles.delete(tracked))
      return tracked
    },
    dispose() {
      for (const h of [...handles]) h.kill()
    },
  }
}
