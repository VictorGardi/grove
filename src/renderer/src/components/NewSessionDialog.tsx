import { useMemo, useState } from 'react'
import type { Feature, Project, SessionKind } from '@shared/types'
import { SANDBOX_DEFAULT, sandboxable, wantsSandbox } from '../sandboxOptIn'
import { useSlices } from '../stores/slices'
import { repoProjectIds } from '../repoGroups'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { ListRow } from './ui/ListRow'
import { Modal } from './ui/Modal'
import s from './NewSessionDialog.module.css'

const KINDS: { kind: SessionKind; label: string; icon: 'opencode' | 'claude' | 'terminal' }[] = [
  { kind: 'claude', label: 'Claude Code', icon: 'claude' },
  { kind: 'opencode', label: 'OpenCode', icon: 'opencode' },
  { kind: 'terminal', label: 'Terminal', icon: 'terminal' },
]

// Where the session runs: a new worktree of the current repo, the checkout itself, one of its
// existing worktrees, or another project's checkout. `new` is the only one that needs a branch.
type Where = { type: 'new'; from: Project } | { type: 'existing'; project: Project }

export interface Launch {
  kind: SessionKind
  where: Where
  branch: string
  prompt: string
  sandboxed: boolean
  feature: string | null
  label: string
}

export function NewSessionDialog({ projectId, onClose, onStart }: {
  projectId?: string
  onClose: () => void
  // resolves to the error, or null once the session started (and the caller closed the dialog).
  // A failure keeps this form open with the reason on it — a worktree conflict or a refused
  // sandbox belongs next to the fields that caused it, not in a banner the form replaced.
  onStart(l: Launch): Promise<string | null>
}) {
  const { projects, features } = useSlices()
  const [kind, setKind] = useState<SessionKind>('claude')
  const [sandboxed, setSandboxed] = useState(SANDBOX_DEFAULT)
  const [prompt, setPrompt] = useState('')
  const [label, setLabel] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [feature, setFeature] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // the current project first, then the rest — the same order the ⌘T palette uses
  const ordered = useMemo(
    () => [...projects.filter((p) => p.id === projectId), ...projects.filter((p) => p.id !== projectId)],
    [projects, projectId],
  )
  const current = ordered[0]
  const [where, setWhere] = useState<Where | null>(null)
  const choice = where ?? (current ? { type: 'existing', project: current } : null)

  // A branch we can propose but not guess: the repo's own name and the lowest free number. The
  // human edits it, and a name grove invented would be a name it then owns.
  const [branch, setBranch] = useState('')
  const suggested = useMemo(() => {
    if (!current) return ''
    const repo = (current.name.split(' · ')[0] || current.name).replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
    const taken = new Set(projects.map((p) => p.name.split(' · ').pop() ?? ''))
    for (let n = 1; ; n++) {
      const candidate = `${repo}/${repo}-${n}`
      if (![...taken].some((t) => t === candidate.split('/').pop())) return candidate
    }
  }, [current, projects])

  // A brand-new worktree has no features of its own until discovery runs there, and the core
  // refuses a link it cannot resolve — so the picker offers the checkout we are forking from and
  // says plainly that the link waits. The session auto-links as soon as it writes to a folder.
  const linkable: Feature[] = choice
    ? features.items.filter((f) => f.projectId === (choice.type === 'new' ? choice.from.id : choice.project.id))
    : []

  const needsBranch = choice?.type === 'new'
  const ready = !!choice && (!needsBranch || branch.trim().length > 0)

  const submit = async () => {
    if (!ready || !choice || busy) return
    setBusy(true)
    setError(null)
    const failed = await onStart({ kind, where: choice, branch: branch.trim() || suggested, prompt, sandboxed, feature, label })
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <Modal onClose={onClose} onConfirm={submit} width="md">
      <div className={s.head}>
        <div className={s.title}>New session</div>
        <div className={s.kinds}>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" className={`${s.kind} ${kind === k.kind ? s.on : ''}`}
              aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
              <Icon name={k.icon} size={13} />{k.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.body}>
        <div className={s.label}>Where</div>
        <div className={s.list}>
          {current && (
            <ListRow tone={choice?.type === 'new' ? 'selected' : 'default'}
              title={`New worktree of ${current.name.split(' · ')[0]}`}
              icon={<Icon name="branch" size={13} />}
              meta={branch.trim() || suggested}
              onClick={() => setWhere({ type: 'new', from: current })} />
          )}
          {ordered.map((p) => {
            const sameRepo = !!choice && repoProjectIds(projects, p.id).has(choice.type === 'new' ? choice.from.id : choice.project.id)
            return (
              <ListRow key={p.id} tone={choice?.type === 'existing' && choice.project.id === p.id ? 'selected' : 'default'}
                title={p.name} icon={<Icon name={p.worktreeOf ? 'branch' : 'folder'} size={13} />}
                meta={sameRepo ? 'same repo' : undefined}
                onClick={() => { setWhere({ type: 'existing', project: p }); setFeature(null) }} />
            )
          })}
        </div>
        {needsBranch && (
          <input className={s.branch} value={branch} placeholder={suggested} aria-label="Branch name"
            onChange={(e) => setBranch(e.target.value)} />
        )}

        <div className={s.label}>Prompt <span className={s.optional}>optional — the agent can wait for it</span></div>
        <textarea className={s.prompt} rows={2} value={prompt} placeholder="What should this session do?" aria-label="Prompt"
          onChange={(e) => setPrompt(e.target.value)} />

        <div className={s.label}>Isolation</div>
        <div className={`${s.isolation} ${sandboxable(kind) ? '' : s.off}`}>
          <button type="button" className={`${s.switch} ${wantsSandbox(kind, sandboxed) ? s.switchOn : ''}`}
            role="switch" aria-checked={wantsSandbox(kind, sandboxed)} aria-label="Run in a sandbox"
            disabled={!sandboxable(kind)} onClick={() => setSandboxed(!sandboxed)} />
          <div className={s.isolationText}>
            <div className={s.isolationTitle}>Run in a sandbox</div>
            <div className={s.body2}>The agent runs inside a Linux VM. Its working directory appears at the
              same path it has on your Mac; the rest of your machine is not visible.
              <b> Network access is unrestricted</b> — this isolates files only.</div>
          </div>
        </div>

        <div className={s.label}>Link to feature</div>
        {needsBranch ? (
          <div className={s.note}>A new worktree has no features of its own until discovery runs there.
            The session links itself as soon as it writes to a feature folder.</div>
        ) : (
          <div className={s.list}>
            {linkable.map((f) => (
              <ListRow key={f.slug} title={f.title} tone={feature === f.slug ? 'selected' : 'default'}
                meta={f.slug} onClick={() => setFeature(feature === f.slug ? null : f.slug)} />
            ))}
            {linkable.length === 0 && <div className={s.note}>No features in this project.</div>}
          </div>
        )}

        <button type="button" className={s.more} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          <Icon name={advanced ? 'chevron-down' : 'chevron-right'} size={12} />Advanced
        </button>
        {advanced && (
          <input className={s.branch} value={label} placeholder="Label — defaults to kind and time" aria-label="Label"
            onChange={(e) => setLabel(e.target.value)} />
        )}
      </div>

      {error && <div className={s.error}>{error}</div>}

      <div className={s.foot}>
        <span className={s.summary}>
          {choice && (choice.type === 'new' ? `new worktree · ${branch.trim() || suggested}` : choice.project.path)}
          {wantsSandbox(kind, sandboxed) ? ' · sandboxed' : ' · on your host'}
        </span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </Modal>
  )
}