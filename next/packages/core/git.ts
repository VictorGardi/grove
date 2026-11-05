import { execFile } from 'node:child_process'
import path from 'node:path'

export interface SpaceGitInfo {
  repoName: string | null
  mainPath: string | null
  branch: string | null
}

const NONE: SpaceGitInfo = { repoName: null, mainPath: null, branch: null }

// Asks git which worktree is the main one for `dir`, and which branch is checked out there.
// Never throws: a folder outside git, or a missing git, gives nulls. A detached HEAD gives a null branch.
export function spaceGitInfo(dir: string): Promise<SpaceGitInfo> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], (error, stdout) => {
      if (error) return resolve(NONE)
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('worktree '))
      if (!line) return resolve(NONE)
      const mainPath = line.slice('worktree '.length).trim()
      execFile('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], (branchError, branchOut) => {
        const name = branchError ? 'HEAD' : branchOut.trim()
        const branch = name === '' || name === 'HEAD' ? null : name
        resolve({ repoName: path.basename(mainPath), mainPath, branch })
      })
    })
  })
}
