import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A real git repo for tests, in `dir` or a new temp folder.
export function gitRepo(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-git-'))) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  git('config', 'commit.gpgsign', 'false')
  const write = (rel: string, text: string | Buffer) => {
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  const commit = (msg = 'c') => {
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', msg)
  }
  return { dir, write, commit, git }
}
