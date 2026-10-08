import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { readFrontmatter, type Parsed } from '../workflow/frontmatter'
import type { Workflow } from '../workflow/parse'

export interface FolderSnapshot {
  slug: string
  path: string
  manifest: Parsed
  files: string[]                  // top-level non-dot files, sorted
  mtimes: Record<string, number>   // file → mtimeMs, for the viewer's live reload
  artifacts: Record<string, Parsed> // stage files (and all_checked targets) that exist
}

const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false

// The discovery root inside a project: `key` of `from_file` (JSON is YAML), else `default`.
export function resolveRoot(projectPath: string, d: Workflow['discovery']): string | null {
  let rel = d.root.default
  if (d.root.from_file && d.root.key) {
    try {
      const cfg = YAML.parse(fs.readFileSync(path.join(projectPath, d.root.from_file), 'utf8'), { schema: 'core' })
      const v = cfg?.[d.root.key]
      if (typeof v === 'string' && v) rel = v
    } catch {
      // missing or unreadable file: use the default
    }
  }
  const root = path.resolve(projectPath, rel)
  return isDir(root) ? root : null
}

export function listFolders(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

function stageFiles(wf: Workflow): Set<string> {
  const names = new Set<string>()
  for (const s of wf.stages) {
    names.add(s.artifact)
    if ('all_checked' in s.complete_when) names.add(s.complete_when.all_checked)
  }
  return names
}

export function readFolder(dir: string, wf: Workflow): FolderSnapshot | null {
  let manifest: string
  try {
    manifest = fs.readFileSync(path.join(dir, wf.discovery.manifest), 'utf8')
  } catch {
    return null
  }
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
  const mtimes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? 0]))
  const wanted = stageFiles(wf)
  const artifacts: Record<string, Parsed> = {}
  for (const f of files) {
    if (wanted.has(f)) artifacts[f] = readFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return { slug: path.basename(dir), path: dir, manifest: readFrontmatter(manifest), files, mtimes, artifacts }
}
