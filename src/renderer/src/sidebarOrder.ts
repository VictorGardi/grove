import type { Project, Session } from '@shared/types'

// Projects in config order, then each project's sessions by start time. Cmd+1..9 counts in this order.
export function sessionsOf(projectId: string, sessions: Session[]): Session[] {
  return sessions.filter((s) => s.projectId === projectId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function sidebarOrder(projects: Project[], sessions: Session[]): Session[] {
  return projects.flatMap((p) => sessionsOf(p.id, sessions))
}
