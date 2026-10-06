import fs from 'node:fs'
import path from 'node:path'

// Best-effort realpath: resolve the nearest existing ancestor, keep the rest (a file may not exist yet).
function real(p: string): string {
  const rest: string[] = []
  let cur = p
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return p
      rest.unshift(path.basename(cur))
      cur = parent
    }
  }
}

// The feature folder a write landed in: `<featureRoot>/<slug>/…`. The last matching path wins
// (a patch's `Move to` follows its source). Relative paths are the session's, i.e. the project's.
export function slugFor(paths: string[], projectPath: string, featureRoot: string | null): string | null {
  if (!featureRoot) return null
  const root = real(featureRoot)
  let slug: string | null = null
  for (const p of paths) {
    const parts = path.relative(root, real(path.resolve(projectPath, p))).split(path.sep)
    if (parts.length < 2 || parts[0] === '..' || parts[0] === '' || parts[0].startsWith('.') || path.isAbsolute(parts[0])) continue
    slug = parts[0]
  }
  return slug
}
