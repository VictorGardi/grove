import fs from 'node:fs'
import path from 'node:path'
import type { Project, Session } from '@shared/types'
import { gitCommonDir } from './git'

// `parent` is the checkout this one is a worktree of, when git says so (ADR 0037). The name
// gains it because `Project.path` fixes the id but not the name, and a flat list of checkouts
// named after their folders ("grove", "fix-auth") reads as unrelated repos.
export function newProject(dir: string, id: string, parent?: Project | null): Project {
  const name = path.basename(dir)
  return { id, name: parent ? `${parent.name} · ${name}` : name, path: dir, ...(parent && { worktreeOf: parent.id }) }
}

export function hasLiveSessions(projectId: string, sessions: Session[]): boolean {
  return sessions.some((s) => s.projectId === projectId && s.lastStatus === 'running')
}

// The registered checkout of the repo `dir` belongs to: the project whose own `.git`
// directory is `dir`'s common dir, which is true of a main checkout and false of a linked
// worktree. null when `dir` is a checkout itself, is in no repo, or its repo's checkout is
// not a project. Derived from git rather than read off `worktreeOf`, which is why a
// hand-added worktree nests with no extra work (design W2).
export function parentCheckout(dir: string, projects: Project[]): Project | null {
  const common = gitCommonDir(dir)
  if (!common) return null
  for (const p of projects) if (path.resolve(p.path) !== path.resolve(dir) && ownGitDir(p.path) === common) return p
  return null
}

// The real path of `<dir>/.git` when it is a directory — a checkout's own git dir, the one
// place a common dir can be *the* main repo's. null for a worktree or for no repo.
function ownGitDir(dir: string): string | null {
  const git = path.join(path.resolve(dir), '.git')
  try {
    return fs.statSync(git).isDirectory() ? fs.realpathSync(git) : null
  } catch {
    return null
  }
}
