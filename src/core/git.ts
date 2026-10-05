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
