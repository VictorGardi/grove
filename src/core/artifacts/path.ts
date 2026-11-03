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

// The bytes of `rel` under `folder`, or null. The path check and the read use one open handle: the file is
// opened without following a symlink at the last segment, and the handle is compared with the path again
// afterwards, so a swap between the check and the read is caught. Node has no openat, so a directory swapped and swapped back
// inside the open itself is narrowed, not eliminated.
// `readSafeFile` also applies the artifact name rules (no dot segments); `readInside` only containment.
export async function readInside(folder: string, rel: string): Promise<Buffer | null> {
  if (!rel || path.isAbsolute(rel)) return null
  let handle: fs.promises.FileHandle | undefined
  try {
    const root = fs.realpathSync(folder)
    const real = fs.realpathSync(path.join(root, rel))
    if (!real.startsWith(root + path.sep)) return null
    handle = await fs.promises.open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const opened = await handle.stat()
    const again = fs.realpathSync(real)
    const now = fs.statSync(again)
    if (!opened.isFile() || again !== real || now.ino !== opened.ino || now.dev !== opened.dev) return null
    return await handle.readFile()
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

export async function readSafeFile(folder: string, rel: string): Promise<Buffer | null> {
  return safeArtifactPath(folder, rel) ? readInside(folder, rel) : null
}
