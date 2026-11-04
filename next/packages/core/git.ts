import { execFile } from 'node:child_process'
import path from 'node:path'

export interface SpaceGitInfo {
  repoName: string | null
  mainPath: string | null
}

const NONE: SpaceGitInfo = { repoName: null, mainPath: null }

// Asks git which worktree is the main one for `dir`. Never throws: a folder outside git, or a missing git, gives nulls.
export function spaceGitInfo(dir: string): Promise<SpaceGitInfo> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], (error, stdout) => {
      if (error) return resolve(NONE)
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('worktree '))
      if (!line) return resolve(NONE)
      const mainPath = line.slice('worktree '.length).trim()
      resolve({ repoName: path.basename(mainPath), mainPath })
    })
  })
}
