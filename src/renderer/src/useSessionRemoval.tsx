import { useState, type ReactNode } from 'react'
import type { Project } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { worktreeBranch } from './launchTargets'
import { useSlices } from './stores/slices'

// The one way a session is removed from the app. Removing the last session of a worktree asks
// whether the checkout should go too, whichever door the removal came through (a card, ⌘W, the
// ended view), so none of them can skip the question. One worktree at a time; the rest wait.
export function useSessionRemoval(): { removeSessions: (ids: string[]) => Promise<void>; dialog: ReactNode } {
  const { projects, sessions } = useSlices()
  const [asking, setAsking] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const next = () => { setError(null); setAsking((l) => l.slice(1)) }

  const removeSessions = async (ids: string[]) => {
    const gone = new Set(ids)
    const emptied = projects.filter((p) => p.worktreeOf
      && sessions.some((s) => s.projectId === p.id)
      && sessions.every((s) => s.projectId !== p.id || gone.has(s.id)))
    await Promise.all(ids.map((id) => window.api.invoke('session:remove', { id })))
    if (emptied.length > 0) setAsking(emptied)
  }

  const dialog = asking.length > 0 && (
    <ConfirmDialog
      title={error ? "Couldn't remove worktree" : 'Remove worktree?'}
      body={error ?? `No sessions are left in ${worktreeBranch(asking[0])}. Remove its checkout from disk too? The branch is kept.`}
      confirmLabel={error ? 'OK' : 'Remove worktree'}
      onCancel={next}
      onConfirm={async () => {
        if (error) return next()
        const res = await window.api.invoke('worktree:remove', { projectId: asking[0].id })
        if (res.ok) next()
        else setError(res.error)
      }} />
  )
  return { removeSessions, dialog }
}
