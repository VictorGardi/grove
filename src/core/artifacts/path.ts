import fs from 'node:fs'
import path from 'node:path'

// Absolute real path of `rel` inside `folder`, or null. `rel` is relative POSIX:
// no backslash, no segment starting with '.', no escape via symlinks, a regular file.
export function safeArtifactPath(folder: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || rel.includes('\\')) return null
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return null
  try {
    const root = fs.realpathSync(folder)
    const real = fs.realpathSync(path.join(root, rel))
    if (!real.startsWith(root + path.sep)) return null
    return fs.statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}
