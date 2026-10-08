import path from 'node:path'
import type { Project, Session } from '@shared/types'

export function newProject(dir: string, id: string): Project {
  return { id, name: path.basename(dir), path: dir }
}

export function hasLiveSessions(projectId: string, sessions: Session[]): boolean {
  return sessions.some((s) => s.projectId === projectId && s.lastStatus === 'running')
}
