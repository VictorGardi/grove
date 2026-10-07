import { createHash } from 'node:crypto'
import type { Feature, Project, SessionDiff } from '@shared/types'
import type { GitRun } from './git'
import { parseUnifiedDiff } from './parse'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

// The session's repo diff against HEAD. `key` fingerprints git's raw output: equal keys, equal diff.
export async function computeDiff(o: { sessionId: string; dir: string; project: Project; features: Feature[]; git: GitRun | null }):
  Promise<{ key: string; diff: SessionDiff }> {
  const base: SessionDiff = { sessionId: o.sessionId, projectId: o.project.id, state: 'ok', error: null, root: null, files: [], truncated: false }
  const { git } = o
  try {
    if (!git) throw new Error('git not found')
    const root = (await git(['rev-parse', '--show-toplevel'], o.dir)).trim()
    const raw = await git(['diff', 'HEAD', '-M', '--no-color', '--no-ext-diff', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/'], root)
    return { key: sha1(raw), diff: { ...base, root, files: parseUnifiedDiff(raw) } }
  } catch (e) {
    const error = (e as Error).message
    return { key: `error:${error}`, diff: { ...base, state: 'error', error } }
  }
}
