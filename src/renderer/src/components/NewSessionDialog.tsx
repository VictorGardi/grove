import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Project, SessionKind } from '@shared/types'
import { score } from '../launchRank'
import { SANDBOX_DEFAULT, sandboxable, wantsSandbox } from '../sandboxOptIn'
import { useSlices } from '../stores/slices'
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

// A row in the picker. Creating and opening are the same kind of thing here, which is the whole
// point: `create` carries the repo to fork and the base it forks from, so the button can name
// what pressing it will actually do.
type Row =
  | { type: 'create'; key: string; repo: Project; base: string | null; branch: string | null; label: string }
  | { type: 'existing'; key: string; project: Project }

export interface Launch {
  kind: SessionKind
  where: { type: 'new'; from: Project; branch: string } | { type: 'existing'; project: Project }
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
  const [query, setQuery] = useState('')
  const [refs, setRefs] = useState<Record<string, { branch: string | null; default: string | null }>>({})
  // the highlighted row, as an index into `rows` — the same shape CommandPalette uses, so ↑/↓,
  // wrap and scroll-into-view behave identically in the two places
  const [at, setAt] = useState(0)
  const rowRef = useRef<HTMLDivElement>(null)

  // Each repo's current and default branch, so a create row can name its base and a checkout row
  // can say what it is on. Read per group head; a worktree's branch is on its own HEAD.
  useEffect(() => {
    let live = true
    const heads = new Set(projects.map((p) => p.worktreeOf ?? p.id))
    for (const p of projects) {
      const id = p.worktreeOf ?? p.id
      if (!heads.has(id) || refs[id]) continue
      void window.api.invoke('repo:refs', { projectId: id }).then((res) => {
        if (live && res.ok) setRefs((r) => ({ ...r, [id]: res.data }))
      })
    }
    return () => { live = false }
  }, [projects, refs])

  // The repo the dialog was opened from, first — so ⌘⇧T lands where ⌘T would have.
  const ordered = useMemo(() => {
    const head = (id: string | undefined) => projects.find((p) => p.id === id)?.worktreeOf ?? id
    const first = head(projectId)
    return [...projects.filter((p) => (p.worktreeOf ?? p.id) === first), ...projects.filter((p) => (p.worktreeOf ?? p.id) !== first)]
  }, [projects, projectId])

  // The rows: create-first while the query is empty, everything after. Zed's arrangement — the
  // creation rows are the answer to an empty query, and filtering moves them below the matches.
  const rows = useMemo(() => {
    const all: Row[] = []
    for (const p of ordered) {
      const ref = refs[p.worktreeOf ?? p.id]
      const base = ref?.default ?? ref?.branch ?? null
      all.push({
        type: 'create', key: `new:${p.worktreeOf ?? p.id}`, repo: p, base,
        branch: null,
        label: base ? `New worktree from ${base}` : 'New worktree',
      })
      all.push({ type: 'existing', key: `use:${p.id}`, project: p })
    }
    const textOf = (r: Row) => (r.type === 'create'
      ? `${r.label} ${r.repo.name}`
      : `${r.project.name} ${refs[r.project.worktreeOf ?? r.project.id]?.branch ?? ''}`)
    const ranked = all
      .map((r) => ({ r, text: textOf(r) }))
      .map(({ r, text }) => ({ r, s: score(query, text) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (b.s ?? 0) - (a.s ?? 0))
      .map((x) => x.r)
    if (!query) return ranked
    // typing a name nobody has used yet is how you create one: Zed synthesises the row rather
    // than making you find a "create" entry first
    const named = ranked.find((r) => r.type === 'create' && r.branch === query)
    if (named || ranked.some((r) => r.type === 'existing' && refs[r.project.id]?.branch === query)) return ranked
    const repo = ordered.find((p) => score(query, p.name) !== null) ?? ordered[0]
    if (!repo) return ranked
    const ref = refs[repo.worktreeOf ?? repo.id]
    const synthesized: Row = { type: 'create', key: `new:${repo.worktreeOf ?? repo.id}:${query}`, repo, base: ref?.default ?? null, branch: query, label: `New worktree from ${ref?.default ?? 'HEAD'}: ${query}` }
    return [synthesized, ...ranked]
  }, [ordered, refs, query])

  // a stale index when the list shrinks under it (the query narrowed) falls back to the top row,
  // so the summary and the button always describe something real
  const current = Math.min(at, Math.max(rows.length - 1, 0))
  const row = rows[current] ?? null

  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, rows])

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
    if (n) setAt((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
  }
  // With nothing chosen and a name typed, the typed name is what would be created — so the
  // button says what it is about to do rather than leaving the choice implicit.
  const creating = row?.type === 'create'
  const creatingBranch = creating && row.branch ? row.branch : creating ? suggestionFor(row.repo, projects) : null

  const linkable: Feature[] = row?.type === 'existing'
    ? features.items.filter((f) => f.projectId === row.project.id)
    : []

  // Committing is deliberate: a click only moves the highlight, so the rest of the form stays
  // editable after choosing where. Enter (Modal's own confirm) and the button are the two doors.
  const submit = async () => {
    if (!row || busy) return
    setBusy(true)
    setError(null)
    const failed = await onStart({
      kind,
      where: row.type === 'create'
        ? { type: 'new', from: row.repo, branch: row.branch ?? suggestionFor(row.repo, projects) }
        : { type: 'existing', project: row.project },
      prompt, sandboxed, feature, label,
    })
    setBusy(false)
    if (failed) setError(failed)
  }

  // Enter is Modal's own: it commits whatever the highlighted row is, so ↵ and the button below
  // always agree on what pressing them does.
  return (
    <Modal onClose={onClose} onConfirm={() => void submit()} width="md">
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

      {/* one search over every checkout and every repo's fork, so neither has to be found first */}
      <div className={s.search}>
        <Icon name="search" size={14} />
        <input autoFocus value={query} placeholder="Select or type to create a worktree…" aria-label="Where"
          onChange={(e) => { setQuery(e.target.value); setAt(0) }} onKeyDown={onKeyDown} />
      </div>

      <div className={s.rows} role="listbox" aria-label="Checkouts">
        {rows.map((r, i) => {
          const on = i === current
          const shared = {
            key: r.key, ref: on ? rowRef : undefined, role: 'option' as const, 'aria-selected': on,
            className: `${s.row} ${on ? s.on : ''}`,
            // hovering moves the highlight, so the keyboard and the mouse never disagree about
            // what Enter would pick — the same rule CommandPalette follows
            // a click selects, it does not commit: the point of this form is choosing where and
            // then still being able to change the kind, the sandbox and the prompt before anything
            // is created. Enter and the button are the two ways to commit.
            onMouseMove: () => setAt(i),
            onClick: () => setAt(i),
          }
          if (r.type === 'existing') {
            const ref = refs[r.project.worktreeOf ?? r.project.id]
            return (
              <div {...shared}>
                <Icon name={r.project.worktreeOf ? 'branch' : 'folder'} size={13} />
                <span className={s.rowName}>{r.project.name}</span>
                <span className={s.rowSub}>{ref?.branch ?? '—'}</span>
              </div>
            )
          }
          return (
            <div {...shared}>
              <span className={s.plus}>＋</span>
              <span className={s.rowName}>{r.label}</span>
              <span className={s.rowSub}>in {r.repo.name}</span>
            </div>
          )
        })}
        {rows.length === 0 && <div className={s.note}>Nothing matches “{query}”.</div>}
      </div>

      <div className={s.body}>
        <div className={s.label}>Prompt <span className={s.optional}>optional — the agent can wait for it</span></div>
        <textarea className={s.prompt} rows={2} value={prompt} placeholder="What should this session do?" aria-label="Prompt"
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
        {creating ? (
          <div className={s.note}>A new worktree has no features of its own until discovery runs there.
            The session links itself as soon as it writes to a feature folder.</div>
        ) : (
          <div className={s.list}>
            {linkable.map((f) => (
              <ListRow key={f.slug} title={f.title} tone={feature === f.slug ? 'selected' : 'default'}
                meta={f.slug} onClick={() => setFeature(feature === f.slug ? null : f.slug)} />
            ))}
            {linkable.length === 0 && <div className={s.note}>No features in this checkout.</div>}
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
        {/* the summary is the whole point of the create/open split: it names the outcome */}
        {/* the outcome is stated here because a row click no longer reveals it by acting */}
        <span className={s.summary}>
          {row && (creating
            ? `creates ${creatingBranch} in ${row.repo.name} · ${wantsSandbox(kind, sandboxed) ? 'sandboxed' : 'on your host'}`
            : `runs in ${row?.type === 'existing' ? row.project.name : ''} · ${wantsSandbox(kind, sandboxed) ? 'sandboxed' : 'on your host'}`)}
        </span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {/* Create vs Start: the button names the action, which is the cheapest way to keep
            creation legible without another control */}
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Working…' : creating ? 'Create' : 'Start'}
        </Button>
      </div>
    </Modal>
  )
}

// A branch we can propose but not guess: the repo's own name and the lowest free number. The
// human edits it, and a name grove invented would be a name it then owns.
function suggestionFor(repo: Project, projects: Project[]): string {
  const slug = repo.name.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
  const taken = new Set(projects.map((p) => p.name.split(' · ').pop() ?? ''))
  for (let n = 1; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}/${slug}-${n}`
  return `${slug}/${slug}`
}