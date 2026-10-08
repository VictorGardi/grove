import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Comment, CommentAnchor, Project, Session, SessionDiff, SessionKind, Slices, UiState } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES, OPENCODE_CONNECTING } from '@shared/types'
import type { Result } from '@shared/ipc'
import { pruneGrid } from '@shared/grid'
import { safeArtifactPath } from './artifacts/path'
import type { AttachHandle, SessionBackend } from './backend/types'
import { terminalTheme } from '@shared/theme'
import { listFolders, readFolder, resolveRoot, type FolderSnapshot } from './discovery/folder'
import { chokidarWatchers, type Closer, type Watchers } from './discovery/watcher'
import { loginShellArgv, minimalEnv } from './env'
import { computeDiff } from './diff/compute'
import { defaultBranch, gitRunner, listBranches } from './diff/git'
import { createDiffWatch } from './diff/watch'
import { reanchorDiff, reanchorFile } from './comments/anchor'
import { slugFor } from './autolink'
import { formatReview } from './comments/format'
import { addComment, draftsOf, dropSession, markSent, removeComment, updateComment } from './comments/model'
import { loadComments, saveComments } from './comments/store'
import type { TurnResult } from '@shared/cli'
import { isDirectory, paneStable, realOrSelf, resolveProject, waitTurn } from './cliOps'
import { sendToSession } from './send'
import { hasLiveSessions, newProject } from './projects'
import { readBranch } from './git'
import type { AgentEvent, AgentKind, AgentSource } from './agents/types'
import { autoLink, link, markGone, markSeen, newSession, reconcile, rename, resume, withBranches } from './sessions'
import { loadConfig, saveConfig } from './store/configStore'
import { apply, fromSnapshot, withContext, withStatus, type Tracker } from './status'
import { loadState, saveState } from './store/stateStore'
import { deriveFeatures } from './workflow/derive'
import { parseWorkflow, type Workflow } from './workflow/parse'

export interface CoreOptions {
  configPath: string // ~/.config/grove/config.json
  statePath: string // <userData>/state.json
  commentsPath: string // <userData>/comments.json
  bundledWorkflowPath: string // used when config.json sets no `workflow`
  watchers?: Watchers // tests inject fakes
  backend: SessionBackend
  sources?: AgentSource[] // one per agent kind; none: tmux-only
  now?: () => Date // tests inject this
  git?: string | null // path to git; undefined: 'git' from PATH, null: not found
  sessionEnv?: { socketPath: string; binDir: string } // the grove CLI's socket and launcher dir; none: sessions get no CLI env
}

type Change = Exclude<AgentEvent, { type: 'connected' | 'disconnected' | 'wrote' }>

// Live state per agent source (D1, ADR 0019): one source reconnecting never touches another's.
interface SourceState {
  source: AgentSource
  connected: boolean
  trackers: Map<string, Tracker> // per root session id
  roots: Map<string, string> // subagent session id → root session id
  syncGen: number // bumped per re-sync and on disconnect; a stale snapshot is dropped
  queue: Change[] | null // events seen while a snapshot is in flight
  primed: boolean // the first re-sync after start records waiting sessions without notifying
  wroteSince: Set<string> // sessions with a live write since the last re-sync began
}

type SliceListener = <K extends keyof Slices>(k: K, v: Slices[K]) => void

export interface Commands {
  projectAdd(a: { path: string }): Promise<Result<Project>>
  projectRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionCreate(a: {
    projectId?: string; cwd?: string; kind: SessionKind; prompt?: string; label?: string; feature?: string; cols: number; rows: number
  }): Promise<Result<Session>> // exactly one of projectId, cwd
  sessionKill(a: { id: string }): Promise<Result<{ id: string }>>
  sessionRemove(a: { id: string }): Promise<Result<{ id: string }>>
  sessionResume(a: { id: string }): Promise<Result<Session>> // gone agent sessions only
  sessionRename(a: { id: string; label: string }): Promise<Result<Session>>
  sessionLink(a: { id: string; feature: string | null }): Promise<Result<Session>>
  uiSet(partial: Partial<UiState>): Promise<Result<UiState>>
  sessionFocusLast(): Promise<Result<{ id: string }>> // the latest earlier session still valid; ⌃Tab
  commentAdd(a: { sessionId: string; anchor: CommentAnchor; body: string }): Promise<Result<Comment>>
  commentUpdate(a: { id: string; body: string }): Promise<Result<Comment>>
  commentDelete(a: { id: string }): Promise<Result<{ id: string }>>
  diffLines(a: { sessionId: string; path: string; from: number; to: number }): Promise<Result<string[]>> // lines of a changed file in the open diff, 1-based inclusive
  diffRefs(a: { sessionId: string }): Promise<Result<{ branches: string[]; default: string | null }>> // branches to offer as a diff base
  reviewSend(a: { sessionId: string }): Promise<Result<{ sent: number }>> // the session's drafts as one message; none: 'empty'
  sendToSession(a: { id: string; text: string; submit?: boolean }): Promise<Result<{ id: string }>>
  sessionRead(a: { id: string; lines: number }): Promise<Result<{ text: string }>> // the pane's last lines; empty when it is gone
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
  waitTurn(id: string, o: { expectStart: boolean; timeoutMs: number }): Promise<Result<TurnResult>>
  attach(sessionId: string, cols: number, rows: number): AttachHandle
  filePath(projectId: string, rel: string): string | null // a viewable file of the project (ADR 0032); null: refused
  dispose(): void
}

const MAX_EXPAND = 20_000 // lines one expansion may read

export function createCore(opts: CoreOptions): Core {
  const { backend } = opts
  const now = opts.now ?? (() => new Date())
  const slices: Slices = { projects: [], sessions: [], ui: DEFAULT_UI, features: EMPTY_FEATURES, opencode: OPENCODE_CONNECTING, diff: null, comments: [] }
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
  const states = new Map<AgentKind, SourceState>((opts.sources ?? []).map((source) => [source.kind, {
    source, connected: false, trackers: new Map(), roots: new Map(), syncGen: 0, queue: null, primed: false, wroteSince: new Set(),
  }]))
  let unreachableTimer: ReturnType<typeof setTimeout> | undefined
  let windowFocused = false
  // Where focus was before it moved, newest last (in memory): removing the focused session returns to the latest still valid one.
  type Focus = Pick<UiState, 'focusedSessionId' | 'focusedFeature' | 'focusedProject'>
  const focusHistory: Focus[] = []
  const FOCUS_HISTORY_MAX = 20
  const sameFocus = (a: Focus, b: Focus) =>
    a.focusedSessionId === b.focusedSessionId && a.focusedProject === b.focusedProject
    && a.focusedFeature?.projectId === b.focusedFeature?.projectId && a.focusedFeature?.slug === b.focusedFeature?.slug
  const focusOf = (ui: UiState): Focus => ({ focusedSessionId: ui.focusedSessionId, focusedFeature: ui.focusedFeature, focusedProject: ui.focusedProject })
  const rememberFocus = (prev: Focus) => {
    if (!prev.focusedSessionId && !prev.focusedFeature && !prev.focusedProject) return
    const at = focusHistory.findIndex((f) => sameFocus(f, prev))
    if (at >= 0) focusHistory.splice(at, 1)
    focusHistory.push(prev)
    if (focusHistory.length > FOCUS_HISTORY_MAX) focusHistory.shift()
  }
  const focusStillValid = (f: Focus) =>
    f.focusedSessionId ? !!findSession(f.focusedSessionId)
      : f.focusedFeature ? slices.features.items.some((x) => x.projectId === f.focusedFeature!.projectId && x.slug === f.focusedFeature!.slug)
        : !!f.focusedProject && slices.projects.some((p) => p.id === f.focusedProject)
  let lastOnScreen: string | null = null
  const waitKey = new Map<string, string>() // session id → waitingFor it was last seen waiting with
  const held = new Map<string, string>() // session id → slug it wrote to that discovery hasn't listed yet
  let lastCwds = new Map<string, string>() // tmux name → pane cwd, from the last refresh
  const sending = new Set<string>() // sessions with a review send in flight
  const gitTop = async (dir: string): Promise<string | null> => {
    if (!git) return null
    try {
      return (await git(['rev-parse', '--show-toplevel'], dir)).trim() || null
    } catch {
      return null // not a repo
    }
  }
  const git = opts.git === null ? null : gitRunner(opts.git ?? 'git', minimalEnv(process.env))

  // GROVE_* for the grove CLI (ADR 0027). Terminal sessions get PATH here; agent sessions through loginShellArgv.
  function cliEnv(session: Session): Record<string, string> | undefined {
    const e = opts.sessionEnv
    if (!e) return undefined
    return {
      GROVE_SESSION_ID: session.id,
      GROVE_SOCKET: e.socketPath,
      ...(session.kind === 'terminal' && { PATH: `${e.binDir}:${minimalEnv(process.env).PATH}` }),
    }
  }
  const shellOpts = () => ({ pathPrefix: opts.sessionEnv?.binDir })

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
      const sessions = slices.sessions.map(
        ({ branch: _branch, status: _status, waitingFor: _waitingFor, contextPct: _p, contextTokens: _t, contextWindow: _w, model: _m, ...s }) => s,
      ) // live-only
      saveState(opts.statePath, { schemaVersion: 7, sessions, ui: slices.ui })
    }
    else if (k === 'comments') saveComments(opts.commentsPath, { schemaVersion: 2, comments: slices.comments })
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
    void reanchorFiles()
  }

  // Drafts on a file follow its text when the file changed on disk (design D3).
  const seenMtime = new Map<string, number>() // projectId/path → mtimeMs at the last re-anchor
  async function reanchorFiles(): Promise<void> {
    const files = new Map<string, { projectId: string; path: string }>()
    for (const c of slices.comments) {
      if (c.state === 'draft' && c.anchor.kind === 'file') files.set(`${c.anchor.projectId}/${c.anchor.path}`, c.anchor)
    }
    for (const [key, { projectId, path: rel }] of files) {
      const file = projectFile(projectId, rel)
      if (!file) continue
      let source: string
      try {
        const mtimeMs = (await fs.promises.stat(file)).mtimeMs
        if (seenMtime.get(key) === mtimeMs) continue
        seenMtime.set(key, mtimeMs)
        source = await fs.promises.readFile(file, 'utf8')
      } catch {
        continue
      }
      const next = reanchorFile(slices.comments, { projectId, path: rel }, source)
      if (next !== slices.comments) set('comments', next)
    }
  }
  const projectFile = (projectId: string, rel: string) => {
    const p = slices.projects.find((x) => x.id === projectId)
    return p ? safeArtifactPath(p.path, rel) : null
  }

  const listed = (projectId: string, slug: string) => discovery.get(projectId)?.folders.has(slug) ?? false

  // The session of this source's kind with this agent id.
  const sessionOf = (st: SourceState, agentId: string) =>
    slices.sessions.find((s) => s.kind === st.source.kind && s.agentSessionId === agentId)

  // Auto-link (E-D6): an unpinned agent session follows the feature folder it last wrote to.
  function linkWrite(st: SourceState, agentId: string, paths: string[]): void {
    const session = sessionOf(st, st.roots.get(agentId) ?? agentId)
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
  async function catchUp(st: SourceState, gen: number, ids: string[]): Promise<void> {
    for (const id of ids) {
      const session = sessionOf(st, id)
      if (!session || session.linkPinned) continue
      let paths: string[]
      try {
        paths = await st.source.lastWrites(id)
      } catch {
        continue
      }
      if (gen !== st.syncGen) return
      if (st.wroteSince.has(session.id) || paths.length === 0) continue
      linkWrite(st, id, paths)
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
    diffWatch.poke() // the 5 s tick keeps an open diff current
  }

  async function refreshBranches(): Promise<void> {
    let cwds: Map<string, string>
    try {
      cwds = await backend.cwds()
    } catch {
      return // retried by the next poll
    }
    lastCwds = cwds
    const next = withBranches(slices.sessions, cwds, readBranch)
    if (next !== slices.sessions) set('sessions', next)
  }

  // The diff of the session's working directory: the pane's cwd, or the project once it's gone.
  // The base to diff against is read fresh off the viewer (not passed in): DiffWatch keys only on
  // session id, so a base change alone doesn't retarget it — syncDiff pokes it instead (D-base).
  async function runDiff(id: string): Promise<{ key: string; diff: SessionDiff }> {
    const s = findSession(id)
    const project = s && slices.projects.find((p) => p.id === s.projectId)
    if (!s || !project) {
      const error = 'session not found'
      return { key: `error:${error}`, diff: { sessionId: id, projectId: s?.projectId ?? '', state: 'error', error, root: null, files: [], truncated: false, base: null } }
    }
    const dir = s.lastStatus === 'running' ? lastCwds.get(s.tmuxName) ?? project.path : project.path
    const v = slices.ui.viewer
    const base = v?.kind === 'diff' && v.sessionId === id ? v.base ?? null : null
    return computeDiff({ sessionId: id, dir, project, git, base })
  }

  const diffWatch = createDiffWatch(runDiff, (d) => {
    set('diff', d)
    if (d) {
      const next = reanchorDiff(slices.comments, d)
      if (next !== slices.comments) set('comments', next)
    }
  })

  // Computed only while the viewer shows a diff (D4). DiffWatch dedupes by session id alone, so a
  // base change on the same session needs an explicit poke to retarget the recompute.
  let lastDiffBase: string | null = null
  function syncDiff(): void {
    const v = slices.ui.viewer
    const id = v?.kind === 'diff' ? v.sessionId : null
    const base = v?.kind === 'diff' ? v.base ?? null : null
    diffWatch.target(id)
    if (id && base !== lastDiffBase) diffWatch.poke()
    lastDiffBase = base
  }

  // The session the human is looking at: focused window, session focused (the focuses are exclusive).
  function onScreenId(): string | null {
    return windowFocused ? slices.ui.focusedSessionId : null
  }

  function withAllStatus(sessions: Session[]): Session[] {
    let next = sessions
    for (const st of states.values()) {
      next = withStatus(next, st.source.kind, st.trackers, st.connected, st.source.statusNeedsEvent)
      next = withContext(next, st.source.kind, st.trackers, st.connected)
    }
    return next
  }

  function refreshStatus(): void {
    let next = withAllStatus(slices.sessions)
    const id = onScreenId()
    const after = id ? next.find((s) => s.id === id) : undefined
    if (after && after.kind !== 'terminal' && states.has(after.kind)) {
      const before = findSession(after.id)
      if (id !== lastOnScreen || after.status !== before?.status || after.waitingFor !== before?.waitingFor) {
        const seen = markSeen(after, now().toISOString())
        next = withAllStatus(next.map((s) => (s.id === seen.id ? seen : s)))
      }
    }
    lastOnScreen = id
    if (next !== slices.sessions) set('sessions', next)
    for (const st of states.values()) if (st.connected && st.queue === null) notifyTransitions(st, id)
  }

  // Notify on entering waiting (or a new reason) off screen. Disconnected sessions keep their entry.
  function notifyTransitions(st: SourceState, onScreen: string | null): void {
    for (const s of slices.sessions) {
      if (s.kind !== st.source.kind || s.lastStatus !== 'running' || !s.status) continue
      if (s.status !== 'waiting' || !s.waitingFor) {
        waitKey.delete(s.id)
        continue
      }
      if (waitKey.get(s.id) === s.waitingFor) continue
      waitKey.set(s.id, s.waitingFor)
      if (st.primed && s.id !== onScreen) for (const cb of notifyListeners) cb(s)
    }
  }

  // The banner shows once the service has been away for 5 s.
  function armUnreachable(): void {
    clearTimeout(unreachableTimer)
    unreachableTimer = setTimeout(() => set('opencode', { state: 'unreachable', version: null }), 5000)
  }

  function applyEvent(st: SourceState, e: Change): void {
    if (e.type === 'child') st.roots.set(e.sessionId, st.roots.get(e.parentId) ?? e.parentId)
    st.trackers = apply(st.trackers, st.roots, e)
  }

  function onEvent(st: SourceState, e: AgentEvent): void {
    if (e.type === 'connected' || e.type === 'disconnected') {
      st.connected = e.type === 'connected'
      st.trackers = new Map()
      st.roots.clear()
      st.syncGen++
      st.queue = null
      if (e.type === 'connected') {
        if (st.source.kind === 'opencode') {
          clearTimeout(unreachableTimer)
          set('opencode', { state: 'connected', version: e.version })
        }
        void resync(st)
      } else if (st.source.kind === 'opencode') {
        set('opencode', OPENCODE_CONNECTING)
        armUnreachable()
      }
    } else if (e.type === 'wrote') {
      const session = sessionOf(st, st.roots.get(e.sessionId) ?? e.sessionId)
      if (session) st.wroteSince.add(session.id)
      linkWrite(st, e.sessionId, e.paths)
      diffWatch.poke() // any session's write: a shared checkout shares its diff
      return
    } else {
      st.queue?.push(e)
      applyEvent(st, e)
      if (e.type === 'exec-ended') diffWatch.poke()
    }
    refreshStatus()
  }

  // A service stop drops pending items silently: every connect rebuilds the trackers from a snapshot.
  async function resync(st: SourceState): Promise<void> {
    const gen = ++st.syncGen
    st.queue = []
    st.wroteSince.clear()
    const ids = slices.sessions
      .filter((s) => s.kind === st.source.kind && s.lastStatus === 'running' && s.agentSessionId)
      .map((s) => s.agentSessionId!)
    let snaps
    try {
      snaps = await st.source.snapshot(ids)
    } catch {
      if (gen !== st.syncGen) return
      st.queue = null // keep what the events built
      refreshStatus()
      st.primed = true
      return
    }
    if (gen !== st.syncGen) return
    const r = fromSnapshot(snaps, ids)
    st.trackers = r.trackers
    st.roots.clear()
    for (const [child, root] of r.roots) st.roots.set(child, root)
    const replay = st.queue ?? []
    st.queue = null
    for (const e of replay) applyEvent(st, e)
    refreshStatus()
    st.primed = true
    void catchUp(st, gen, ids)
  }

  const findSession = (id: string) => slices.sessions.find((s) => s.id === id)

  function replaceSession(next: Session): void {
    set('sessions', slices.sessions.map((s) => (s.id === next.id ? next : s)))
  }

  function dropSessions(keep: (s: Session) => boolean): void {
    const focused = slices.ui.focusedSessionId ? findSession(slices.ui.focusedSessionId) : undefined
    const removed = slices.sessions.filter((s) => !keep(s))
    set('sessions', slices.sessions.filter(keep))
    let comments = slices.comments
    for (const s of removed) comments = dropSession(comments, s.id)
    if (comments.length !== slices.comments.length) set('comments', comments)
    let ui = slices.ui
    // back to where focus was before; failing that, the project page takes over (ADR 0018)
    if (focused && !findSession(focused.id)) {
      let back: Focus | undefined
      while (focusHistory.length > 0 && !back) {
        const f = focusHistory.pop()!
        if (focusStillValid(f)) back = f
      }
      ui = { ...ui, ...(back ?? { focusedSessionId: null, focusedFeature: null, focusedProject: focused.projectId }) }
    }
    const v = ui.viewer
    if (v?.kind === 'diff' && !findSession(v.sessionId)) ui = { ...ui, viewer: null }
    else if (v && v.kind !== 'diff' && v.fromDiff && !findSession(v.fromDiff)) ui = { ...ui, viewer: { ...v, fromDiff: null } }
    const grid = pruneGrid(ui.grid, (id) => !!findSession(id))
    if (grid !== ui.grid) ui = { ...ui, grid }
    if (ui !== slices.ui) set('ui', ui)
    syncDiff()
  }

  // Removed agent sessions: each source drops what it keeps for them (Claude: the spool).
  function forgetAgents(gone: Session[]): void {
    for (const s of gone) if (s.kind !== 'terminal' && s.agentSessionId) states.get(s.kind)?.source.forget(s.agentSessionId)
  }

  const sendDeps = { find: findSession, backend, resume: (id: string) => commands.sessionResume({ id }) }

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
      const gone = slices.sessions.filter((s) => s.projectId === id)
      dropSessions((s) => s.projectId !== id)
      forgetAgents(gone)
      if (slices.ui.focusedProject === id) set('ui', { ...slices.ui, focusedProject: null })
      syncProjects(false)
      return { ok: true, data: { id } }
    },

    // `projectId` (the app) or `cwd` (the CLI, ADR 0029): a folder resolves to its project, registered when new.
    async sessionCreate({ projectId, cwd, kind, prompt, label, feature, cols, rows }) {
      const source = kind === 'terminal' ? undefined : states.get(kind)?.source
      if (kind !== 'terminal' && !source) return { ok: false, error: 'no-source' }
      let project = slices.projects.find((p) => p.id === projectId)
      let added = false
      let dir: string | null = null // the folder inside the project, null: the project path
      if (cwd !== undefined) {
        if (!isDirectory(cwd)) return { ok: false, error: 'not-found' }
        ;({ project, added } = await resolveProject(slices.projects, cwd, gitTop))
        const real = fs.realpathSync(cwd)
        dir = real === realOrSelf(project.path) ? null : real
      }
      if (!project) return { ok: false, error: 'not-found' }
      const chosen = project
      if (feature !== undefined && (added || !slices.features.items.some((f) => f.projectId === chosen.id && f.slug === feature))) {
        return { ok: false, error: 'no-feature' } // checked before anything is created
      }
      const agentSessionId = source ? source.mintId(now()) : null
      const session = {
        ...newSession({ projectId: project.id, kind, now: now(), id: randomUUID(), agentSessionId, cwd: dir, label }),
        ...(feature !== undefined && { feature, linkPinned: true }),
      }
      const argv = source
        ? loginShellArgv(source.argv(agentSessionId!, 'start', { prompt, name: label }), shellOpts())
        : undefined
      await backend.create({ name: session.tmuxName, cwd: dir ?? project.path, cols, rows, argv, env: cliEnv(session) })
      await backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)
      if (added) {
        set('projects', [...slices.projects, project])
        syncProjects(false)
      }
      set('sessions', [...slices.sessions, session])
      refreshStatus()
      if (prompt && kind === 'terminal') {
        // no launch argument for a shell: type it once the prompt has drawn (sent even if the pane never settles)
        void paneStable(() => backend.capture(session.tmuxName, 50), { intervalMs: 300, timeoutMs: 10_000 })
          .then(() => commands.sendToSession({ id: session.id, text: prompt, submit: true }))
          .catch(() => {})
      }
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

    // Ends the session if it is still running and forgets it. Kill alone leaves a resumable gone session (the CLI).
    async sessionRemove({ id }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      await backend.kill(session.tmuxName) // already-missing counts as success
      dropSessions((s) => s.id !== id)
      forgetAgents([session])
      return { ok: true, data: { id } }
    },

    // E-D3: a new tmux session of the same name runs the agent's resume argv (`opencode -s <id>`,
    // `claude --resume <id>`), picking up its history.
    async sessionResume({ id }) {
      const session = findSession(id)
      const project = session && slices.projects.find((p) => p.id === session.projectId)
      if (!session || !project) return { ok: false, error: 'not-found' }
      if (session.kind === 'terminal' || !session.agentSessionId) return { ok: false, error: 'not-agent' }
      if (session.lastStatus !== 'gone') return { ok: false, error: 'not-gone' }
      const st = states.get(session.kind)
      if (!st) return { ok: false, error: 'no-source' }
      await backend.kill(session.tmuxName) // a leftover dead pane
      const argv = loginShellArgv(st.source.argv(session.agentSessionId, 'resume'), shellOpts())
      await backend.create({ name: session.tmuxName, cwd: session.cwd ?? project.path, cols: 80, rows: 24, argv, env: cliEnv(session) }) // attaching resizes it
      await backend.setColors(session.tmuxName, terminalTheme.foreground, terminalTheme.background)
      replaceSession(resume(findSession(id) ?? session))
      if (st.connected) void resync(st)
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
      if (!sameFocus(focusOf(slices.ui), focusOf(next))) rememberFocus(focusOf(slices.ui))
      const entered = partial.focusedSessionId && partial.focusedSessionId !== slices.ui.focusedSessionId ? findSession(partial.focusedSessionId) : undefined
      if (entered) replaceSession({ ...entered, lastFocusedAt: now().toISOString() })
      set('ui', next)
      refreshStatus() // the on-screen session may have changed
      syncDiff()
      return { ok: true, data: slices.ui }
    },

    async sessionFocusLast() {
      const cur = slices.ui.focusedSessionId
      for (let i = focusHistory.length - 1; i >= 0; i--) {
        const id = focusHistory[i].focusedSessionId
        if (id && id !== cur && findSession(id)) {
          const r = await commands.uiSet({ focusedSessionId: id })
          return r.ok ? { ok: true, data: { id } } : r
        }
      }
      return { ok: false, error: 'not-found' }
    },

    async commentAdd({ sessionId, anchor, body }) {
      if (!findSession(sessionId)) return { ok: false, error: 'not-found' }
      const r = addComment(slices.comments, { id: randomUUID(), sessionId, anchor, body, now: now().toISOString() })
      if (!r.ok) return r
      set('comments', r.comments)
      return { ok: true, data: r.comment }
    },

    async commentUpdate({ id, body }) {
      const r = updateComment(slices.comments, id, body, now().toISOString())
      if (!r.ok) return r
      set('comments', r.comments)
      return { ok: true, data: r.comment }
    },

    async commentDelete({ id }) {
      if (!slices.comments.some((c) => c.id === id)) return { ok: false, error: 'not-found' }
      set('comments', removeComment(slices.comments, id))
      return { ok: true, data: { id } }
    },

    // Unmodified lines the diff left out, read from the working tree. Only files of the open diff.
    async diffLines({ sessionId, path: rel, from, to }) {
      const d = slices.diff
      const f = d && d.sessionId === sessionId && d.state === 'ok' && d.root ? d.files.find((x) => x.path === rel) : undefined
      if (!d?.root || !f || f.status === 'deleted' || f.binary) return { ok: false, error: 'not-found' }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from >= MAX_EXPAND) return { ok: false, error: 'bad-range' }
      try {
        const root = await fs.promises.realpath(d.root)
        const file = await fs.promises.realpath(path.join(root, rel))
        if (!file.startsWith(root + path.sep)) return { ok: false, error: 'not-found' }
        const text = await fs.promises.readFile(file, 'utf8')
        return { ok: true, data: text.split('\n').slice(from - 1, to).map((l) => l.replace(/\r$/, '')) }
      } catch {
        return { ok: false, error: 'not-found' }
      }
    },

    async diffRefs({ sessionId }) {
      const s = findSession(sessionId)
      const project = s && slices.projects.find((p) => p.id === s.projectId)
      if (!s || !project) return { ok: false, error: 'not-found' }
      if (!git) return { ok: true, data: { branches: [], default: null } }
      const dir = s.lastStatus === 'running' ? lastCwds.get(s.tmuxName) ?? project.path : project.path
      try {
        const root = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
        const [branches, def] = await Promise.all([listBranches(git, root), defaultBranch(git, root)])
        return { ok: true, data: { branches, default: def } }
      } catch {
        return { ok: true, data: { branches: [], default: null } } // not a repo, or git failed: no bases to offer
      }
    },

    async reviewSend({ sessionId }) {
      const session = findSession(sessionId)
      const project = session && slices.projects.find((p) => p.id === session.projectId)
      if (!session || !project) return { ok: false, error: 'not-found' }
      if (sending.has(sessionId)) return { ok: false, error: 'busy' }
      const drafts = draftsOf(slices.comments, sessionId)
      if (drafts.length === 0) return { ok: false, error: 'empty' }
      const text = formatReview(drafts, {
        projectPath: project.path,
      })
      sending.add(sessionId)
      try {
        const sent = await sendToSession(sendDeps, { id: sessionId, text })
        if (!sent.ok) return sent
        // re-read: the drafts may have changed while the paste ran; only these were sent
        set('comments', markSent(slices.comments, drafts.map((c) => c.id), now().toISOString()))
        return { ok: true, data: { sent: drafts.length } }
      } finally {
        sending.delete(sessionId)
      }
    },

    sendToSession: (a) => sendToSession(sendDeps, a),
    async sessionRead({ id, lines }) {
      const session = findSession(id)
      if (!session) return { ok: false, error: 'not-found' }
      return { ok: true, data: { text: await backend.capture(session.tmuxName, lines) } }
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
      slices.comments = loadComments(opts.commentsPath, onBad).comments
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
      syncDiff()
      poll = setInterval(() => {
        void checkLiveness()
        syncProjects(false) // picks up a root that appears later
      }, 5000)
      if (states.has('opencode')) armUnreachable()
      for (const st of states.values()) st.source.start((e) => onEvent(st, e))
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
    waitTurn: (id, o) => waitTurn({
      find: findSession,
      onSessions(cb) {
        const l: SliceListener = (k) => { if (k === 'sessions') cb() }
        listeners.add(l)
        return () => void listeners.delete(l)
      },
    }, id, o),
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
    filePath: (projectId, rel) => projectFile(projectId, rel),
    dispose() {
      clearInterval(poll)
      clearTimeout(unreachableTimer)
      diffWatch.dispose()
      for (const st of states.values()) st.source.stop()
      void workflowWatch?.close()
      for (const id of [...discovery.keys()]) closeEntry(id)
      for (const h of [...handles]) h.kill()
    },
  }
}
