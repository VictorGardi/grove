import fs from 'node:fs'
import path from 'node:path'

// The branch checked out at `dir`'s nearest repo (a `.git` folder, or a worktree's
// `.git` file), read from HEAD without spawning git. Detached: a short hash. null: no repo.
export function readBranch(dir: string): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const head = headFile(path.join(d, '.git'))
    if (head) {
      const text = fs.readFileSync(head, 'utf8').trim()
      const ref = /^ref: refs\/heads\/(.+)$/.exec(text)
      return ref ? ref[1] : text.slice(0, 7) || null
    }
    if (path.dirname(d) === d) return null
  }
}

function headFile(git: string): string | null {
  try {
    if (fs.statSync(git).isDirectory()) return path.join(git, 'HEAD')
    const gitdir = /^gitdir: (.+)$/m.exec(fs.readFileSync(git, 'utf8'))?.[1].trim()
    return gitdir ? path.join(path.resolve(path.dirname(git), gitdir), 'HEAD') : null
  } catch {
    return null // no .git here, or an unreadable one
  }
}

// The common git dir of `dir`'s nearest repo: a checkout's own `.git` directory, or — for a
// linked worktree, whose `.git` is a file redirecting to <main>/.git/worktrees/<name> — the
// main repo's `.git`, which `commondir` names relative to that gitdir. Read, never spawned,
// like readBranch. This is what says which repository a checkout belongs to. null: no repo,
// or a `.git` file that is not a redirect (the same shape headFile falls back on).
export function gitCommonDir(dir: string): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const git = path.join(d, '.git')
    let isDir = false
    try {
      isDir = fs.statSync(git).isDirectory()
    } catch {
      // no .git here; keep walking up
    }
    if (isDir) return real(git)
    const gitdir = gitFile(git)
    if (gitdir) return real(readCommonDir(gitdir) ?? gitdir)
    if (path.dirname(d) === d) return null
  }
}

// The absolute gitdir a worktree's `.git` file redirects to; null when there is no file there.
function gitFile(git: string): string | null {
  try {
    const target = /^gitdir: (.+)$/m.exec(fs.readFileSync(git, 'utf8'))?.[1].trim()
    return target ? path.resolve(path.dirname(git), target) : null
  } catch {
    return null
  }
}

function readCommonDir(gitdir: string): string | null {
  try {
    const rel = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()
    return rel ? path.resolve(gitdir, rel) : null
  } catch {
    return null // no commondir: the gitdir is its own
  }
}

// Real path so two checkouts of one repo compare equal however they were spelled; the
// resolved path when it does not exist, which is what commondir can name for a pruned worktree.
function real(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
