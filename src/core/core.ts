import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Project, Session, SessionKind, Slices, UiState } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES, OPENCODE_CONNECTING } from '@shared/types'
import type { Result } from '@shared/ipc'
import { safeArtifactPath } from './artifacts/path'
import type { AttachHandle, SessionBackend } from './backend/types'
import { terminalTheme } from '@shared/theme'
import { listFolders, readFolder, resolveRoot, type FolderSnapshot } from './discovery/folder'
import { chokidarWatchers, type Closer, type Watchers } from './discovery/watcher'
import { claudeArgv } from './claude/hooks'
import { loginShellArgv } from './env'
import { slugFor } from './autolink'
import { hasLiveSessions, newProject } from './projects'
import { readBranch } from './git'
import type { OcEvent, OpenCodeSource } from './opencode/types'
import { mintSessionId } from './opencodeId'
import { autoLink, link, markGone, markSeen, newSession, reconcile, rename, resume, withBranches } from './sessions'
import { loadConfig, saveConfig } from './store/configStore'
import { apply, fromSnapshot, withStatus, type Tracker } from './status'
import { loadState, saveState } from './store/stateStore'
import { deriveFeatures } from './workflow/derive'
import { parseWorkflow, type Workflow } from './workflow/parse'

export interface CoreOptions {
  configPath: string // ~/.config/grove/config.json
  statePath: string // <userData>/state.json
  bundledWorkflowPath: string // used when config.json sets no `workflow`
  watchers?: Watchers // tests inject fakes
  backend: SessionBackend
  opencode?: OpenCodeSource // absent: tmux-only
  claudeSpoolDir?: string // <userData>/agents/claude; absent: no Claude sessions
  now?: () => Date // tests inject this
}

type OcChange = Exclude<OcEvent, { type: 'connected' | 'disconnected' | 'wrote' }>

type SliceListener = <K extends keyof Slices>(k: K, v: Slices[K]) => void

export interface Commands {
  projectAdd(a: { path: string }): Promise<Result<Project>>
  projectRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionCreate(a: { projectId: string; kind: SessionKind; cols: number; rows: number }): Promise<Result<Session>>
  sessionKill(a: { id: string }): Promise<Result<{ id: string }>>
  sessionRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionResume(a: { id: string }): Promise<Result<Session>> // gone OpenCode sessions only
  sessionRename(a: { id: string; label: string }): Promise<Result<Session>>
  sessionLink(a: { id: string; feature: string | null }): Promise<Result<Session>>
  uiSet(partial: Partial<UiState>): Promise<Result<UiState>>
}

export interface Core {
  start(): Promise<void>
  getSlices(): Slices
  getErrors(): string[]
  on(e: 'slice', cb: SliceListener): () => void
  on(e: 'notify', cb: (s: Session) => void): () => void // a session started waiting while not on screen
  setWindowFocused(f: boolean): void
  checkLiveness(): Promise<void>
  commands: Commands
  attach(sessionId: string, cols: number, rows: number): AttachHandle
  artifactPath(projectId: string, slug: string, rel: string): string | null // null: not a file of a discovered feature
  dispose(): void
}

export function createCore(opts: CoreOptions): Core {
  const { backend } = opts
  const now = opts.now ?? (() => new Date())
  const slices: Slices = { projects: [], sessions: [], ui: DEFAULT_UI, features: EMPTY_FEATURES, opencode: OPENCODE_CONNECTING }
  const errors: string[] = []
  const listeners = new Set<SliceListener>()
  const notifyListeners = new Set<(s: Session) => void>()
  const handles = new Set<AttachHandle>()
  let poll: ReturnType<typeof setInterval> | undefined
  const watchers = opts.watchers ?? chokidarWatchers
  let configWorkflow: string | undefined
  let workflow: Workflow | null = null // last valid
  let workflowError: string | null = null
  let workflowWatch: Closer | undefined
  const discovery = new Map<string, {
    root: string | null
    fromFile: string | null
    folders: Map<string, FolderSnapshot>
    rootWatch?: Closer
    fileWatch?: Closer
  }>()
  let trackers = new Map<string, Tracker>() // OpenCode state per root session id
  const roots = new Map<string, string>() // subagent session id → root session id
  let ocConnected = false
  let unreachableTimer: ReturnType<typeof setTimeout> | undefined
  let syncGen = 0 // bumped per re-sync and on disconnect; a stale snapshot is dropped
  let queue: OcChange[] | null = null // events seen while a snapshot is in flight
  let windowFocused = false
  let lastOnScreen: string | null = null
  const waitKey = new Map<string, string>() // session id → waitingFor it was last seen waiting with
  let primed = false // the first re-sync after start records waiting sessions without notifying
  const held = new Map<string, string>() // session id → slug it wrote to that discovery hasn't listed yet
  const wroteSince = new Set<string>() // sessions with a live write since the last re-sync began

  function set<K extends keyof Slices>(k: K, v: Slices[K]): void {
    slices[k] = v
    for (const l of listeners) l(k, v)
    if (k === 'projects') {
      saveConfig(opts.configPath, {
        schemaVersion: 1,
        projects: slices.projects,
        ...(configWorkflow !== undefined && { workflow: configWorkflow }),
      })
    }
    else if (k === 'sessions' || k === 'ui') {
      const sessions = slices.sessions.map(({ branch: _branch, status: _status, waitingFor: _waitingFor, ...s }) => s) // live-only
      saveState(opts.statePath, { schemaVersion: 2, sessions, ui: slices.ui })
    }
    if (k === 'sessions') publish() // card state reads linked sessions
  }

  // config.json `workflow` (absolute or ~/…), else the bundled example. null: rejected path.
  function workflowFile(): string | null {
    if (configWorkflow === undefined) return opts.bundledWorkflowPath
    if (configWorkflow.startsWith('~/')) return path.join(os.homedir(), configWorkflow.slice(2))
    if (path.isAbsolute(configWorkflow)) return configWorkflow
    workflowError = 'config.json workflow: expected an absolute path or ~/…'
    return null
  }

  // An invalid or unreadable file keeps the last valid workflow and sets the error.
  function loadWorkflow(file: string): void {
    try {
      const res = parseWorkflow(fs.readFileSync(file, 'utf8'))
      if (res.ok) {
        workflow = res.workflow
        workflowError = null
      } else workflowError = `${file}: ${res.error}`
    } catch (e) {
      workflowError = `${file}: ${(e as Error).message}`
    }
  }

  function readAll(root: string, wf: Workflow): Map<string, FolderSnapshot> {
    const out = new Map<string, FolderSnapshot>()
    try {
      for (const slug of listFolders(root)) {
        const snap = readOne(root, slug, wf)
        if (snap) out.set(slug, snap)
      }
    } catch {
      // root vanished mid-read; the next sync clears it
    }
    return out
  }

  function readOne(root: string, slug: string, wf: Workflow): FolderSnapshot | null {
    try {
      return readFolder(path.join(root, slug), wf)
    } catch {
      return null // deleted while reading
    }
  }

  // Re-resolve a project's root; re-read and re-watch it when it moved (or `force`).
  function syncProject(p: Project, force: boolean): void {
    const wf = workflow
    if (!wf) return
    let entry = discovery.get(p.id)
    if (!entry) discovery.set(p.id, (entry = { root: null, fromFile: null, folders: new Map() }))
    const { from_file } = wf.discovery.root
    const fromFile = from_file ? path.join(p.path, from_file) : null
    if (fromFile !== entry.fromFile) {
      void entry.fileWatch?.close()
      entry.fromFile = fromFile
      entry.fileWatch = fromFile ? watchers.watchFile(fromFile, () => { syncProject(p, false); publish() }) : undefined
    }
    const root = resolveRoot(p.path, wf.discovery)
    if (!force && root === entry.root) return
    void entry.rootWatch?.close()
    entry.root = root
    entry.folders = root ? readAll(root, wf) : new Map()
    entry.rootWatch = root ? watchers.watchRoot(root, (slug) => rereadFolder(p.id, slug)) : undefined
  }

  function closeEntry(id: string): void {
    const entry = discovery.get(id)
    void entry?.rootWatch?.close()
    void entry?.fileWatch?.close()
    discovery.delete(id)
  }

  function syncProjects(force: boolean): void {
    for (const id of [...discovery.keys()]) if (!slices.projects.some((p) => p.id === id)) closeEntry(id)
    for (const p of slices.projects) syncProject(p, force)
    publish()
  }

  function rereadFolder(projectId: string, slug: string): void {
    const entry = discovery.get(projectId)
    if (!workflow || !entry?.root) return
    const snap = readOne(entry.root, slug, workflow)
    if (snap) entry.folders.set(slug, snap)
    else entry.folders.delete(slug)
    publish()
  }

  // Derive from the cached folders. Not persisted.
  function publish(): void {
    const wf = workflow
    if (!wf) return set('features', { ...EMPTY_FEATURES, workflowError })
    const folders = [...discovery].flatMap(([projectId, e]) => [...e.folders.values()].map((f) => ({ ...f, projectId })))
    set('features', {
      workflowError,
      stages: wf.stages.map(({ id, label }) => ({ id, label })),
      items: deriveFeatures(wf, folders, slices.sessions),
    })
    applyHeld()
  }

  const listed = (projectId: string, slug: string) => discovery.get(projectId)?.folders.has(slug) ?? false

  // Auto-link (E-D6): an unpinned OpenCode session follows the feature folder it last wrote to.
  function linkWrite(ocSessionId: string, paths: string[]): void {
    const root = roots.get(ocSessionId) ?? ocSessionId
    const session = slices.sessions.find((s) => s.kind === 'opencode' && s.agentSessionId === root)
    if (!session || session.linkPinned) return
    const project = slices.projects.find((p) => p.id === session.projectId)
    const slug = project && slugFor(paths, project.path, discovery.get(project.id)?.root ?? null)
    if (!slug) return
    if (!listed(session.projectId, slug)) {
      held.set(session.id, slug) // linked once discovery lists it; a newer write replaces it
      return
    }
    held.delete(session.id)
    if (session.feature !== slug) replaceSession(autoLink(session, slug))
  }

  function applyHeld(): void {
    for (const [id, slug] of [...held]) {
      const session = findSession(id)
      if (!session || session.linkPinned) held.delete(id)
      else if (listed(session.projectId, slug)) {
        held.delete(id)
        if (session.feature !== slug) replaceSession(autoLink(session, slug))
      }
    }
  }

  // Links from each session's latest write, for writes made while grove wasn't listening.
  async function catchUp(gen: number, ids: string[]): Promise<void> {
    const source = opts.opencode
    if (!source) return
    for (const id of ids) {
      const session = slices.sessions.find((s) => s.kind === 'opencode' && s.agentSessionId === id)
      if (!session || session.linkPinned) continue
      let paths: string[]
      try {
        paths = await source.lastWrites(id)
      } catch {
        continue
      }
      if (gen !== syncGen) return
      if (wroteSince.has(session.id) || paths.length === 0) continue
      linkWrite(id, paths)
    }
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
    await refreshBranches()
  }

  async function refreshBranches(): Promise<void> {
    let cwds: Map<string, string>
    try {
      cwds = await backend.cwds()
    } catch {
      return // retried by the next poll
    }
    const next = withBranches(slices.sessions, cwds, readBranch)
    if (next !== slices.sessions) set('sessions', next)
  }

  // The session the human is looking at: focused window, session focused (the focuses are exclusive).
  function onScreenId(): string | null {
    return windowFocused ? slices.ui.focusedSessionId : null
  }

  function refreshStatus(): void {
    let next = withStatus(slices.sessions, trackers, ocConnected)
    const id = onScreenId()
    const after = id ? next.find((s) => s.id === id) : undefined
    if (after?.kind === 'opencode') {
      const before = findSession(after.id)
      if (id !== lastOnScreen || after.status !== before?.status || after.waitingFor !== before?.waitingFor) {
        const seen = markSeen(after, now().toISOString())
        next = withStatus(next.map((s) => (s.id === seen.id ? seen : s)), trackers, ocConnected)
      }
    }
    lastOnScreen = id
    if (next !== slices.sessions) set('sessions', next)
    if (ocConnected && queue === null) notifyTransitions(id)
  }

  // Notify on entering waiting (or a new reason) off screen. Disconnected sessions keep their entry.
  function notifyTransitions(onScreen: string | null): void {
    for (const s of slices.sessions) {
      if (s.kind !== 'opencode' || s.lastStatus !== 'running' || !s.status) continue
      if (s.status !== 'waiting' || !s.waitingFor) {
        waitKey.delete(s.id)
        continue
      }
      if (waitKey.get(s.id) === s.waitingFor) continue
      waitKey.set(s.id, s.waitingFor)
      if (primed && s.id !== onScreen) for (const cb of notifyListeners) cb(s)
    }
  }

  // The banner shows once the service has been away for 5 s.
  function armUnreachable(): void {
    clearTimeout(unreachableTimer)
    unreachableTimer = setTimeout(() => set('opencode', { state: 'unreachable', version: null }), 5000)
  }

  function applyOc(e: OcChange): void {
    if (e.type === 'child') roots.set(e.sessionId, roots.get(e.parentId) ?? e.parentId)
    trackers = apply(trackers, roots, e)
  }

  function onOcEvent(e: OcEvent): void {
    if (e.type === 'connected' || e.type === 'disconnected') {
      ocConnected = e.type === 'connected'
      trackers = new Map()
      roots.clear()
      syncGen++
      queue = null
      if (e.type === 'connected') {
        clearTimeout(unreachableTimer)
        set('opencode', { state: 'connected', version: e.version })
        void resync()
      } else {
        set('opencode', OPENCODE_CONNECTING)
        armUnreachable()
      }
    } else if (e.type === 'wrote') {
      const root = roots.get(e.sessionId) ?? e.sessionId
      const session = slices.sessions.find((s) => s.kind === 'opencode' && s.agentSessionId === root)
      if (session) wroteSince.add(session.id)
      linkWrite(e.sessionId, e.paths)
      return
    } else {
      queue?.push(e)
      applyOc(e)
    }
    refreshStatus()
  }

  // A service stop drops pending items silently: every connect rebuilds the trackers from a snapshot.
  async function resync(): Promise<void> {
    const source = opts.opencode
    if (!source) return
    const gen = ++syncGen
    queue = []
    wroteSince.clear()
    const ids = slices.sessions
      .filter((s) => s.kind === 'opencode' && s.lastStatus === 'running' && s.agentSessionId)
      .map((s) => s.agentSessionId!)
    let snaps
    try {
      snaps = await source.snapshot(ids)
    } catch {
      if (gen !== syncGen) return
      queue = null // keep what the events built
      refreshStatus()
      primed = true
      return
    }
    if (gen !== syncGen) return
    const r = fromSnapshot(snaps, ids)
    trackers = r.trackers
    roots.clear()
    for (const [child, root] of r.roots) roots.set(child, root)
    const replay = queue ?? []
    queue = null
    for (const e of replay) applyOc(e)
    refreshStatus()
    primed = true
    void catchUp(gen, ids)
  }

  const findSession = (id: string) => slices.sessions.find((s) => s.id === id)

  function replaceSession(next: Session): void {
    set('sessions', slices.sessions.map((s) => (s.id === next.id ? next : s)))
  }

  function dropSessions(keep: (s: Session) => boolean): void {
    const focused = slices.ui.focusedSessionId ? findSession(slices.ui.focusedSessionId) : undefined
    set('sessions', slices.sessions.filter(keep))
    // the last project page takes over (ADR 0018)
    if (focused && !findSession(focused.id)) set('ui', { ...slices.ui, focusedSessionId: null, focusedProject: focused.projectId })
  }

  const commands: Commands = {
    async projectAdd({ path }) {
      const project = newProject(path, randomUUID())
      set('projects', [...slices.projects, project])
      syncProjects(false)
      return { ok: true, data: project }
    },

    async projectRemove({ id }) {
      if (!slices.projects.some((p) => p.id === id)) return { ok: false, error: 'not-found' }
      if (hasLiveSessions(id, slices.sessions)) return { ok: false, error: 'has-live-sessions' }
      set('projects', slices.projects.filter((p) => p.id !== id))
      dropSessions((s) => s.projectId !== id)
      if (slices.ui.focusedProject === id) set('ui', { ...slices.ui, focusedProject: null })
      syncProjects(false)
      return { ok: true, data: { id } }
    },

    async sessionCreate({ projectId, kind, cols, rows }) {
      const project = slices.projects.find((p) => p.id === projectId)
      if (!project) return { ok: false, error: 'not-found' }
      const dir = opts.claudeSpoolDir
      if (kind === 'claude' && !dir) return { ok: false, error: 'no-source' }
      const agentSessionId = kind === 'opencode' ? mintSessionId(now().getTime()) : kind === 'claude' ? randomUUID() : null
      const session = newSession({ projectId, kind, now: now(), id: randomUUID(), agentSessionId })
      let argv: string[] | undefined
      if (kind === 'opencode') argv = loginShellArgv(['opencode', '-s', agentSessionId!])
      else if (kind === 'claude') {
        fs.mkdirSync(dir!, { recursive: true, mode: 0o700 })
        argv = loginShellArgv(claudeArgv(agentSessionId!, path.join(dir!, `${agentSessionId}.jsonl`), 'start'))
      }
      await backend.create({ name: session.tmuxName, cwd: project.path, cols, rows, argv })
      await backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)
      set('sessions', [...slices.sessions, session])
      refreshStatus()
      return { ok: true, data: findSession(session.id) ?? session }
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

    // E-D3: a new tmux session of the same name runs `opencode -s <id>`, picking up its history.
    async sessionResume({ id }) {
      const session = findSession(id)
      const project = session && slices.projects.find((p) => p.id === session.projectId)
      if (!session || !project) return { ok: false, error: 'not-found' }
      if (session.kind !== 'opencode' || !session.agentSessionId) return { ok: false, error: 'not-opencode' }
      if (session.lastStatus !== 'gone') return { ok: false, error: 'not-gone' }
      await backend.kill(session.tmuxName) // a leftover dead pane
      const argv = loginShellArgv(['opencode', '-s', session.agentSessionId])
      await backend.create({ name: session.tmuxName, cwd: project.path, cols: 80, rows: 24, argv }) // attaching resizes it
      await backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)
      replaceSession(resume(findSession(id) ?? session))
      if (ocConnected) void resync()
      refreshStatus()
      return { ok: true, data: findSession(id)! }
    },

    async sessionRename({ id, label }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      const next = rename(session, label)
      replaceSession(next)
      return { ok: true, data: next }
    },

    async sessionLink({ id, feature }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      if (feature !== null && !slices.features.items.some((f) => f.projectId === session.projectId && f.slug === feature)) {
        return { ok: false, error: 'not-found' }
      }
      const next = link(session, feature)
      replaceSession(next)
      return { ok: true, data: next }
    },

    async uiSet(partial) {
      const next = { ...slices.ui, ...partial }
      // one focus at a time: a session, a feature page or a project page
      if (partial.focusedSessionId) Object.assign(next, { focusedFeature: null, focusedProject: null })
      if (partial.focusedFeature) Object.assign(next, { focusedSessionId: null, focusedProject: null })
      if (partial.focusedProject) Object.assign(next, { focusedSessionId: null, focusedFeature: null })
      set('ui', next)
      refreshStatus() // the on-screen session may have changed
      return { ok: true, data: slices.ui }
    },
  }

  return {
    async start() {
      const onBad = (m: string) => errors.push(m)
      const config = loadConfig(opts.configPath, onBad)
      slices.projects = config.projects
      configWorkflow = config.workflow
      const state = loadState(opts.statePath, onBad)
      slices.sessions = state.sessions
      slices.ui = state.ui
      const file = workflowFile()
      if (file) {
        loadWorkflow(file)
        workflowWatch = watchers.watchFile(file, () => {
          loadWorkflow(file)
          syncProjects(true)
        })
      }
      syncProjects(true)
      try {
        await backend.ensureConfig()
        const next = reconcile(slices.sessions, await backend.list(), now().toISOString())
        if (next !== slices.sessions) set('sessions', next)
        await refreshBranches()
      } catch (e) {
        errors.push(`tmux: ${(e as Error).message}`)
      }
      poll = setInterval(() => {
        void checkLiveness()
        syncProjects(false) // picks up a root that appears later
      }, 5000)
      if (opts.opencode) {
        armUnreachable()
        opts.opencode.start(onOcEvent)
      }
    },
    getSlices: () => slices,
    getErrors: () => [...errors],
    on(e: 'slice' | 'notify', cb: SliceListener | ((s: Session) => void)) {
      const bag = (e === 'slice' ? listeners : notifyListeners) as Set<typeof cb>
      bag.add(cb)
      return () => void bag.delete(cb)
    },
    setWindowFocused(f) {
      windowFocused = f
      refreshStatus()
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
    artifactPath(projectId, slug, rel) {
      const f = slices.features.items.find((x) => x.projectId === projectId && x.slug === slug)
      return f ? safeArtifactPath(f.path, rel) : null
    },
    dispose() {
      clearInterval(poll)
      clearTimeout(unreachableTimer)
      opts.opencode?.stop()
      void workflowWatch?.close()
      for (const id of [...discovery.keys()]) closeEntry(id)
      for (const h of [...handles]) h.kill()
    },
  }
}
