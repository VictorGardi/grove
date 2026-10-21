import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Project, SessionKind } from '@shared/types'
import { branchFor, buildRows, orderProjects, repoOf } from '../launchRows'
import { SANDBOX_DEFAULT, sandboxable, wantsSandbox } from '../sandboxOptIn'
import { usualKind } from '../usualKind'
import { useRepoRefs } from '../useRepoRefs'
import { useSlices } from '../stores/slices'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Switch } from './ui/Switch'
import s from './NewSessionDialog.module.css'

const KINDS: { kind: SessionKind; label: string; icon: 'opencode' | 'claude' | 'terminal' }[] = [
  { kind: 'claude', label: 'Claude Code', icon: 'claude' },
  { kind: 'opencode', label: 'OpenCode', icon: 'opencode' },
  { kind: 'terminal', label: 'Terminal', icon: 'terminal' },
]

// The feature as one line of a dropdown. Two features can share a title, and the slug is what tells
// them apart, so it is spelled out only where the titles alone would not — a name is the thing
// being looked for, and doubling every option with its folder path is noise.
function featureLabel(all: Feature[], f: Feature): string {
  return all.some((o) => o.slug !== f.slug && o.title === f.title) ? `${f.title} · ${f.slug}` : f.title
}

export interface Launch {
  kind: SessionKind
  where: { type: 'new'; from: Project; branch: string; base?: string } | { type: 'existing'; project: Project }
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
  const { projects, sessions, features } = useSlices()
  const refs = useRepoRefs(projects)
  // The kind is a guess until the human picks one: `null` hands the decision to usualKind, so
  // moving the highlight onto another repo re-reads that repo's habit instead of keeping the
  // previous row's. A click pins it, and a pinned kind is never second-guessed.
  const [picked, setPicked] = useState<SessionKind | null>(null)
  const [sandboxed, setSandboxed] = useState(SANDBOX_DEFAULT)
  const [prompt, setPrompt] = useState('')
  const [label, setLabel] = useState('')
  const [feature, setFeature] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // The highlight follows a row's identity, not its position: refs arriving or the query narrowing
  // rebuild the rows and would otherwise slide the selection onto whatever landed at that index.
  // Null until something is chosen, which is the top row.
  const [at, setAt] = useState<string | null>(null)
  // The branch name as edited, tied to the row it was edited on so choosing another row starts clean.
  const [edited, setEdited] = useState<{ key: string; value: string } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  // Choosing a row (a click, or ↵ in the search) hands the keyboard to the rest of the form. It
  // never commits: the branch name, the prompt and the sandbox are still to be decided.
  const [chose, setChose] = useState(0)

  const ordered = useMemo(() => orderProjects(projects, projectId), [projects, projectId])
  const rows = useMemo(() => buildRows(ordered, refs, query), [ordered, refs, query])
  const current = Math.max(rows.findIndex((r) => r.key === at), 0)
  const row = rows[current] ?? null
  const create = row?.type === 'create' ? row : null
  const existing = row?.type === 'existing' ? row : null

  // Which repo the highlighted row belongs to, which is the one whose habit is worth reading: a
  // create row forks a repo, an open row runs in one, and either way the answer is the same repo.
  const repoId = create ? repoOf(create.repo) : existing ? repoOf(existing.project) : undefined
  const kind = picked ?? usualKind(sessions, projects, repoId)

  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, rows])
  useEffect(() => { if (chose) (branchRef.current ?? promptRef.current)?.focus() }, [chose])
  const choose = (key: string) => { setAt(key); setChose((n) => n + 1) }

  const branch = create ? branchFor(create, edited?.key === create.key ? edited.value : null, projects) : ''
  const linkable: Feature[] = existing ? features.items.filter((f) => f.projectId === existing.project.id) : []
  const where = create ? `creates ${branch} in ${create.repo.name}` : `runs in ${existing?.project.name ?? ''}`
  // The feature the session would carry: the one that was picked, or none. A create row never
  // links, and a checkout with no features has nothing to link to however the state reads.
  const linked = existing && linkable.some((f) => f.slug === feature) ? feature : null

  const onKeyDown = (e: React.KeyboardEvent) => {
    // ⌘↵ commits from anywhere in the form, so you can click a row, go fix the sandbox toggle or
    // write a prompt, and still commit without reaching for the mouse. Modal owns bare ↵.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      void submit()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const n = rows.length
    if (n) setAt(rows[(current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].key)
  }

  // Committing is deliberate: a click only moves the highlight, so the rest of the form stays
  // editable after choosing where. The button, ⌘↵, and ↵ in any field after the search are the doors.
  const submit = async () => {
    const target = create ? { type: 'new' as const, from: create.repo, branch } : existing && { type: 'existing' as const, project: existing.project }
    if (!target || busy) return
    setBusy(true)
    setError(null)
    const failed = await onStart({
      kind,
      where: target,
      prompt, sandboxed, feature: linked, label,
    })
    setBusy(false)
    if (failed) setError(failed)
  }

  const isolation = wantsSandbox(kind, sandboxed) ? 'sandboxed' : 'on your host'

  return (
    <Modal onClose={onClose} onConfirm={() => (document.activeElement === searchRef.current ? row && choose(row.key) : void submit())} width="md">
      <div className={s.head}>
        <div className={s.title}>New session</div>
        <div className={s.kinds}>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" className={`${s.kind} ${kind === k.kind ? s.kindOn : ''}`}
              aria-pressed={kind === k.kind} onClick={() => setPicked(k.kind)}>
              <Icon name={k.icon} size={13} />{k.label}
            </button>
          ))}
        </div>
      </div>

      {/* one search over every checkout and every repo's fork, so neither has to be found first */}
      <div className={s.search}>
        <Icon name="search" size={14} />
        <input ref={searchRef} autoFocus value={query} placeholder="Select or type to create a worktree…" aria-label="Where"
          onChange={(e) => { setQuery(e.target.value); setAt(null) }} onKeyDown={onKeyDown} />
      </div>

      {/* a click or ↵ chooses and moves on to the form; only the button, ⌘↵ or ↵ in a later field commits */}
      <div className={s.rows} role="listbox" aria-label="Checkouts">
        {rows.map((r, i) => {
          const on = i === current
          return (
            <div key={r.key} ref={on ? rowRef : undefined} role="option" aria-selected={on}
              className={`${s.row} ${on ? s.on : ''}`}
              onClick={() => choose(r.key)}>
              {r.type === 'existing' ? (
                <>
                  <Icon name={r.project.worktreeOf ? 'branch' : 'folder'} size={13} />
                  <span className={s.rowName}>{r.project.name}</span>
                  <span className={s.rowSub}>{refs[repoOf(r.project)]?.branch ?? '—'}</span>
                </>
              ) : (
                <>
                  <span className={s.plus}>＋</span>
                  <span className={s.rowName}>{r.label}</span>
                  <span className={s.rowSub}>in {r.repo.name}</span>
                </>
              )}
              {on && <Icon name="check" size={13} />}
            </div>
          )
        })}
        {rows.length === 0 && <div className={s.note}>Nothing matches “{query}”.</div>}
      </div>

      <div className={s.body}>
        {create && (
          <>
            <div className={s.label}>New branch <span className={s.optional}>from {create.base ?? 'HEAD'}</span></div>
            <input ref={branchRef} className={s.branch} aria-label="New branch name" placeholder={branch}
              value={edited?.key === create.key ? edited.value : create.branch ?? ''}
              onChange={(e) => setEdited({ key: create.key, value: e.target.value })}
              onKeyDown={onKeyDown} />
          </>
        )}

        <div className={s.label}>Prompt <span className={s.optional}>optional — the agent can wait for it</span></div>
        <textarea ref={promptRef} className={s.prompt} rows={2} value={prompt} placeholder="What should this session do?" aria-label="Prompt"
          onChange={(e) => setPrompt(e.target.value)}
          // ⇧↩ or ⌘↩ commits, matching CommentEditor: a newline is ↵ here, as it is everywhere
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.shiftKey)) {
              e.preventDefault()
              e.stopPropagation()
              void submit()
            }
          }} />

        <div className={s.label}>Isolation</div>
        <div className={`${s.isolation} ${sandboxable(kind) ? '' : s.off}`}>
          <Switch checked={wantsSandbox(kind, sandboxed)} disabled={!sandboxable(kind)}
            label="Run in a sandbox" onChange={setSandboxed} />
          <div className={s.isolationText}>
            <div className={s.isolationTitle}>Run in a sandbox</div>
            <div className={s.hint}>The agent runs inside a Linux VM. Its working directory appears at the
              same path it has on your Mac; the rest of your machine is not visible.
              <b> Network access is unrestricted</b> — this isolates files only.</div>
          </div>
        </div>

        <div className={s.label}>Link to feature</div>
        {create ? (
          <div className={s.note}>A new worktree has no features of its own until discovery runs there.
            The session links itself as soon as it writes to a feature folder.</div>
        ) : linkable.length === 0 ? (
          <div className={s.note}>No features in this checkout.</div>
        ) : (
          /* A select, not a list of rows: the feature is a name that has to be looked up once, and a
             list of them cost a screen's worth of dialog to answer a question most launches never
             ask. Native because the popup is the platform's, which is where a person's eye goes
             when they are looking for one name out of many. */
          <select className={s.select} aria-label="Link to feature" value={linked ?? ''}
            onChange={(e) => setFeature(e.target.value || null)}>
            <option value="">No feature</option>
            {linkable.map((f) => <option key={f.slug} value={f.slug}>{featureLabel(linkable, f)}</option>)}
          </select>
        )}

        <div className={s.label}>Label <span className={s.optional}>optional — defaults to kind and time</span></div>
        <input className={s.text} value={label} placeholder="What this session is for" aria-label="Label"
          onChange={(e) => setLabel(e.target.value)} />
      </div>

      {error && <div className={s.error}>{error}</div>}

      <div className={s.foot}>
        {/* the summary names the outcome, because a row click only selects */}
        <span className={s.summary}>{row && `${where} · ${isolation}`}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !row} onClick={() => void submit()}>
          {busy ? <><Spinner /> {create ? 'Creating…' : 'Starting…'}</> : create ? 'Create' : 'Start'}
        </Button>
      </div>
    </Modal>
  )
}
