import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitError, runGit, type GitRun } from '../gitrun.ts'

// Which repository a request's working folder belongs to, for "Where it went". Worktrees roll up into their main checkout, a
// repository that is a current Space is marked, and a folder with neither repository nor Space (scratch and temp folders, the home
// folder, no folder at all) is "Other". Git is asked once per folder, in the background, and the answer is kept: until it
// arrives, and for a folder that no longer exists, the folder's path decides (Grove's own worktree layout, a containing Space).

export interface RepositoryPlaces {
  home: string
  // Where Grove puts worktrees: <root>/<repo>/<branch>.
  worktreesRoot: string
  // Folders whose contents are scratch work, never a project of their own.
  scratch: string[]
}

export const defaultPlaces = (): RepositoryPlaces => ({
  home: os.homedir(),
  worktreesRoot: path.join(os.homedir(), '.grove', 'worktrees'),
  scratch: [...new Set([os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'])],
})

export interface RepositoryRef {
  // Identifies the repository, and is never shown. '' for "Other".
  id: string
  // The repository's folder name; null for "Other".
  name: string | null
  space: boolean
}

export interface RepositoryResolverOptions {
  git?: GitRun
  // The folders of the current Spaces.
  spaces: () => string[]
  places?: RepositoryPlaces
  clock?: () => number
  // Called when an answer changed what a summary shows.
  onChange: () => void
  // How many git calls run at once, and how long one may take.
  concurrency?: number
  gitTimeoutMs?: number
  // How long an answer that was only a guess (no repository found, folder gone, git failed) is kept before git is asked again.
  retryMs?: number
}

const OTHER: RepositoryRef = { id: '', name: null, space: false }
const CONCURRENCY = 4
const GIT_TIMEOUT_MS = 5000
const RETRY_MS = 10 * 60_000

interface Answer {
  // A repository's main checkout, or null when git found none.
  main: string | null
  // Git answered. Otherwise this is a guess and git is asked again after the retry time.
  final: boolean
  at: number
}

const tidy = (folder: string): string => (folder.length > 1 ? folder.replace(/[\\/]+$/, '') : folder)
const inside = (folder: string, root: string): boolean => folder === root || folder.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
const nameOf = (id: string): string => path.basename(id).replace(/\.git$/, '') || id

export class RepositoryResolver {
  private readonly git: GitRun
  private readonly places: RepositoryPlaces
  private readonly clock: () => number
  private readonly answers = new Map<string, Answer>()
  private readonly wanted = new Set<string>()
  private readonly inFlight = new Set<string>()
  private active = 0
  private idle: Array<() => void> = []
  private closed = false
  // Counts answers, so a summary can be reused while none arrived.
  version = 0

  constructor(private readonly options: RepositoryResolverOptions) {
    this.git = options.git ?? runGit
    this.places = options.places ?? defaultPlaces()
    this.clock = options.clock ?? Date.now
  }

  close(): void {
    this.closed = true
    this.wanted.clear()
  }

  // Resolves once no folder is waiting for git.
  settled(): Promise<void> {
    return this.active === 0 && this.wanted.size === 0 ? Promise.resolve() : new Promise((resolve) => this.idle.push(resolve))
  }

  // The repository of each folder as known now. Folders git has not answered for yet are looked up in the background, and
  // `onChange` is called when that changes what this returns.
  snapshot(): (folder: string) => RepositoryRef {
    const spaceRoots = this.options.spaces().map(tidy)
    for (const root of spaceRoots) this.want(root)
    const spaceIds = new Set(spaceRoots.map((root) => this.idOf(root, spaceRoots)).filter((id): id is string => id !== null))
    const known = new Map<string, RepositoryRef>()
    return (folder) => {
      const cached = known.get(folder)
      if (cached) return cached
      this.want(folder)
      const id = this.idOf(tidy(folder), spaceRoots)
      const ref = id === null ? OTHER : { id, name: nameOf(id), space: spaceIds.has(id) }
      known.set(folder, ref)
      return ref
    }
  }

  // The repository id of a folder from what is known: git's answer, else the folder's path.
  private idOf(folder: string, spaceRoots: string[]): string | null {
    if (folder === '' || folder === this.places.home) return null
    // Scratch is scratch even when it is a repository, unless the human made it a Space.
    if (this.places.scratch.some((root) => inside(folder, tidy(root))) && !spaceRoots.some((root) => inside(folder, root))) return null
    const answer = this.answers.get(folder)
    if (answer?.main != null) return answer.main === this.places.home ? null : answer.main
    return this.byPath(folder, spaceRoots)
  }

  private byPath(folder: string, spaceRoots: string[]): string | null {
    // The Space the folder is in (the longest), which is its repository when that is a worktree git already answered for.
    let space: string | undefined
    for (const root of spaceRoots) if (inside(folder, root) && (space === undefined || root.length > space.length)) space = root
    if (space !== undefined) {
      const main = this.answers.get(space)?.main
      return main != null && main !== this.places.home ? main : space
    }
    // A worktree made by Grove, <worktrees>/<repo>/<branch>: its repository is the main checkout we know by that name, if the
    // one folder name belongs to one repository.
    if (inside(folder, this.places.worktreesRoot) && folder !== this.places.worktreesRoot) {
      const repo = path.relative(this.places.worktreesRoot, folder).split(path.sep)[0]
      const mains = new Set<string>()
      for (const root of spaceRoots) {
        const main = this.answers.get(root)?.main ?? root
        if (path.basename(main) === repo && !inside(main, this.places.worktreesRoot)) mains.add(main)
      }
      for (const answer of this.answers.values()) if (answer.main !== null && path.basename(answer.main) === repo) mains.add(answer.main)
      return mains.size === 1 ? [...mains][0] : path.join(this.places.worktreesRoot, repo)
    }
    // A worktree an agent made inside its repository, <repo>/.claude/worktrees/<name>, which is the repository when it is a Space.
    const agentTree = folder.indexOf(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
    if (agentTree > 0) {
      const main = folder.slice(0, agentTree)
      return spaceRoots.some((root) => this.answers.get(root)?.main === main || root === main) ? main : null
    }
    return null
  }

  private want(folder: string): void {
    const answer = this.answers.get(folder)
    if (this.closed || folder === '' || folder === this.places.home || this.wanted.has(folder) || this.inFlight.has(folder)) return
    if (answer !== undefined && (answer.final || this.clock() - answer.at < (this.options.retryMs ?? RETRY_MS))) return
    this.wanted.add(folder)
    this.pump()
  }

  private pump(): void {
    while (this.active < (this.options.concurrency ?? CONCURRENCY)) {
      const folder = this.wanted.values().next().value
      if (folder === undefined) break
      this.wanted.delete(folder)
      this.inFlight.add(folder)
      this.active++
      void this.resolve(folder).finally(() => {
        this.inFlight.delete(folder)
        this.active--
        this.pump()
      })
    }
    if (this.active === 0 && this.wanted.size === 0) for (const resolve of this.idle.splice(0)) resolve()
  }

  private async resolve(folder: string): Promise<void> {
    const spaceRoots = this.options.spaces().map(tidy)
    const before = this.idOf(folder, spaceRoots)
    let answer: Answer = { main: null, final: false, at: this.clock() }
    // Async, so a stale mount cannot hold the event loop.
    if ((await fs.promises.stat(folder).catch(() => undefined))?.isDirectory()) {
      try {
        const main = firstWorktree(await this.git(['worktree', 'list', '--porcelain'], folder, { kind: 'read', timeoutMs: this.options.gitTimeoutMs ?? GIT_TIMEOUT_MS }))
        answer = { main, final: main !== null, at: this.clock() }
      } catch (error) {
        // Not a repository, a timeout or no git: the path decides for now. The log line leaves the folder out: git's own message names it.
        if (!(error instanceof GitError && error.notRepo)) console.error(`core: usage could not place a folder in a repository: ${error instanceof GitError && error.timedOut ? 'git timed out' : 'git failed'}`)
      }
    }
    if (this.closed) return
    this.answers.set(folder, answer)
    if (this.idOf(folder, spaceRoots) !== before) {
      this.version++
      this.options.onChange()
    }
  }
}

// The main checkout, the first worktree git lists.
function firstWorktree(porcelain: string): string | null {
  const line = porcelain.split('\n').find((candidate) => candidate.startsWith('worktree '))
  const main = line?.slice('worktree '.length).trim()
  return main ? tidy(main) : null
}
