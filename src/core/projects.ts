import path from 'node:path'
import type { Project } from '@shared/types'

export function newProject(dir: string, id: string): Project {
  return { id, name: path.basename(dir), path: dir }
}
