import { useState } from 'react'
import type { Project, Session } from '@shared/types'
import { worktreeBranch } from '../launchTargets'
import { ConfirmDialog } from './ConfirmDialog'

// Removing a worktree's checkout, as one conversation: ask, try, and when git refuses (uncommitted
// work, a lock) show its message and offer Force remove. Forcing is only ever offered after git
// has said no, so the human has read what is about to be lost. `sessions` are the ones still
// running in it: they are listed in the question and ended by the first try, and stay ended if
// the human backs out at the force step.
export function WorktreeRemoveDialog({ project, sessions = [], intro, onDone, onCancel }: {
  project: Project
  sessions?: Session[]
  // the first line of the question, for a caller that knows why it is asking
  intro?: string
  // `removed` is false when the human backed out, or the removal failed in a way force cannot fix
  onDone: (removed: boolean) => void
  onCancel: () => void
}) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const branch = worktreeBranch(project)

  const run = async (force: boolean) => {
    setBusy(true)
    const res = await window.api.invoke('worktree:remove', { projectId: project.id, force, endSessions: sessions.length > 0 })
    setBusy(false)
    if (res.ok) return onDone(true)
    if (res.error === 'git-refused') setRefusal(res.detail ?? 'git refused to remove it')
    else setError(res.error)
  }

  if (error) return <ConfirmDialog title="Couldn't remove worktree" body={error} confirmLabel="OK" onCancel={() => onDone(false)} onConfirm={() => onDone(false)} />
  if (refusal) {
    return (
      <ConfirmDialog
        title="Force remove worktree?"
        body={`Git refused to remove ${branch}:\n${refusal.trim()}\n\nForcing deletes the checkout, including uncommitted changes. The branch is kept.`}
        confirmLabel="Force remove"
        busy={busy}
        onCancel={onCancel}
        onConfirm={() => run(true)} />
    )
  }
  const live = sessions.length > 0
    ? ` ${sessions.length === 1 ? '1 session' : `${sessions.length} sessions`} running in it will be ended.`
    : ''
  return (
    <ConfirmDialog
      title="Remove worktree?"
      body={`${intro ?? `Remove the checkout of ${branch} from disk?`}${live} The branch is kept.`}
      confirmLabel="Remove worktree"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => run(false)} />
  )
}
