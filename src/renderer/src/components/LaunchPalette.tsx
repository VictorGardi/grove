import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, Session, SessionKind } from '@shared/types'
import { baseChoices, branchName, buildTargets, tidyPath, type ChosenBases, type Target } from '../launchTargets'
import { suggestBranch, repoOf, type RefsByRepo } from '../launchRows'
import { wantsSandbox } from '../sandboxOptIn'
import { usualKind } from '../usualKind'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { SandboxToggle } from './SandboxToggle'
import type { Launch } from './NewSessionDialog'
import s from './LaunchPalette.module.css'

const KINDS: { kind: SessionKind; label: string; icon: 'opencode' | 'claude' | 'terminal'; code: string; key: string }[] = [
  { kind: 'claude', label: 'Claude Code', icon: 'claude', code: 'Digit1', key: '1' },
  { kind: 'opencode', label: 'OpenCode', icon: 'opencode', code: 'Digit2', key: '2' },
  { kind: 'terminal', label: 'Terminal', icon: 'terminal', code: 'Digit3', key: '3' },
]

// ⌘T: where a session goes, and everything that shapes it, in one box and one keyboard.
//
// The rows are places — a repo, its worktrees, a way to make another — and the agent is a switch
// beside them, because the two are independent choices and a list of every pairing was a wall.
// The one input is both the filter and the name of a worktree nobody has made yet, so making one is
// ⌘T, a name, ↵. Every control under the list has a key written next to it (⌥ plus a letter, since
// the menu already owns ⌘1–9), so nothing here needs the pointer and nothing is a hidden mode.
//
// A new worktree forks the repo's default branch unless ⌥B picks another: a second step that swaps
// the list for the repo's branches, local and already fetched, and returns here with the choice.
export function LaunchPalette({ projects, sessions, openedFrom, refs, sandboxed, onSandbox, onClose, onStart }: {
  projects: Project[]
  sessions: Session[]
  openedFrom: string | undefined
  refs: RefsByRepo
  // The sandbox choice outlives the launcher (it is left on across launches), so the caller owns it.
  sandboxed: boolean
  onSandbox: (next: boolean) => void
  onClose: () => void
  // Resolves to the error, or null once the session started. A refusal stays on this form, next to
  // the fields that caused it, rather than in a banner the form has already closed over.
  onStart(l: Launch): Promise<string | null>
}) {
  const [query, setQuery] = useState('')
  // The highlight follows a row's key, not its index: refs arriving or the query narrowing rebuild
  // the list, and an index would slide the highlight onto whatever landed there.
  const [at, setAt] = useState<string | null>(null)
  const [picked, setPicked] = useState<SessionKind | null>(null)
  // the base picked per repo, so it holds while the highlight moves between repos and back
  const [chosen, setChosen] = useState<ChosenBases>({})
  // the base picker, when open: it takes over the box and the list until a branch is picked or Esc
  const [picking, setPicking] = useState<{ repoId: string; query: string; at: number } | null>(null)
  const [label, setLabel] = useState('')
  // the branch field, remembered against the row it was typed for so moving to another row drops it
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  const targets = useMemo(() => buildTargets(projects, openedFrom, refs, query, chosen), [projects, openedFrom, refs, query, chosen])
  const current = Math.max(targets.findIndex((t) => t.key === at), 0)
  const target = targets[current]
  const grouped = !query.trim()
  const repos = new Set(projects.map(repoOf)).size
  const choices = useMemo(() => (picking ? baseChoices(refs, picking.repoId, picking.query) : []), [picking, refs])
  const choiceAt = Math.min(picking?.at ?? 0, Math.max(choices.length - 1, 0))

  // A guess until the human picks: `null` hands it to the repo's own habit, so moving onto another
  // repo re-reads that repo's usual agent instead of keeping the last one's.
  const kind = picked ?? usualKind(sessions, projects, target?.repo.id)
  // what a create row will name its branch: what was typed in the branch field, else what the search
  // carried, else a proposal
  const proposal = target?.type === 'create' ? suggestBranch(target.repo, projects) : ''
  const branchShown = target?.type === 'create' ? (edit?.key === target.key ? edit.value : target.branch ?? '') : ''
  const branchFinal = branchName(branchShown) || proposal
  const isolated = wantsSandbox(kind, sandboxed)

  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, targets])

  const submit = async (t: Target | undefined = target) => {
    if (!t || busy) return
    setBusy(true)
    setError(null)
    const failed = await onStart({
      kind,
      where: t.type === 'create'
        // the base named on the row is the one sent, so what the row says is what git forks
        ? { type: 'new', from: t.repo, branch: t.key === target?.key ? branchFinal : t.branch ?? suggestBranch(t.repo, projects), ...(t.base && { base: t.base }) }
        : { type: 'existing', project: t.project },
      prompt: '', sandboxed, feature: null, label,
    })
    setBusy(false)
    if (failed) setError(failed)
  }

  // A new worktree needs a name, so choosing its row (click or ↵ in the search) moves to the branch
  // field instead of starting; ↵ there, or in the label, starts it. Any other row starts at once.
  const choose = (t: Target | undefined = target) => {
    if (t?.type === 'create' && document.activeElement !== branchRef.current && document.activeElement !== labelRef.current) {
      setAt(t.key)
      setTimeout(() => branchRef.current?.focus(), 0) // the field only exists once this row is the target
      return
    }
    void submit(t)
  }

  const openPicker = () => {
    if (target?.type !== 'create') return
    setPicking({ repoId: target.repo.id, query: '', at: 0 })
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  // Picking a base returns to the branch field: the base was the one thing still undecided.
  const pickBase = () => {
    const base = choices[choiceAt]
    if (!base || !picking) return
    setChosen((c) => ({ ...c, [picking.repoId]: base }))
    setPicking(null)
    setTimeout(() => branchRef.current?.focus(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (picking) {
      if (e.key === 'Tab') { e.preventDefault(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = choices.length
        if (n) setPicking({ ...picking, at: (choiceAt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
      }
      return
    }
    if (e.key === 'Tab') {
      // Two places take text, so Tab trades between them; the buttons under the list are all
      // reachable by key and would only be somewhere for the focus to get lost.
      e.preventDefault()
      const order = [searchRef.current, target?.type === 'create' ? branchRef.current : null, labelRef.current].filter((x): x is HTMLInputElement => !!x)
      const next = (order.indexOf(e.target as HTMLInputElement) + (e.shiftKey ? order.length - 1 : 1)) % order.length
      order[next].focus()
      return
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey) {
      // `code`, not `key`: ⌥ composes a different character on a Mac (⌥S is ß)
      const k = KINDS.find((x) => x.code === e.code)
      if (k) { e.preventDefault(); setPicked(k.kind); return }
      if (e.code === 'KeyS') { e.preventDefault(); onSandbox(!sandboxed); return }
      if (e.code === 'KeyB') { e.preventDefault(); openPicker(); return }
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const n = targets.length
    if (n) setAt(targets[(current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].key)
  }

  const where = !target ? '' : target.type === 'create'
    ? `new worktree ${branchFinal} from ${target.base ?? 'HEAD'}`
    : `${target.worktree ? target.branch : target.repo.name}`
  const verb = target?.type === 'create' ? 'Create' : 'Start'

  return (
    <Modal onClose={() => (picking ? setPicking(null) : onClose())} onConfirm={() => (picking ? pickBase() : choose())}>
      <div className={s.root} onKeyDown={onKeyDown}>
        <div className={s.box}>
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            autoFocus
            className={s.input}
            value={picking ? picking.query : query}
            placeholder={picking ? 'Fork from which branch…' : 'Pick a place, or type a name to make a worktree…'}
            aria-label={picking ? 'Base branch' : 'Where'}
            onChange={(e) => {
              if (picking) { setPicking({ ...picking, query: e.target.value, at: 0 }); return }
              setQuery(e.target.value); setAt(null); setError(null)
            }}
          />
        </div>

        {picking ? (
          <div className={s.list} role="listbox" aria-label="Branch to fork">
            {choices.map((b, i) => (
              <div key={b} ref={i === choiceAt ? rowRef : undefined} role="option" aria-selected={i === choiceAt}
                className={cx(s.row, i === choiceAt && s.on)}
                onClick={() => { setChosen((c) => ({ ...c, [picking.repoId]: b })); setPicking(null); setTimeout(() => branchRef.current?.focus(), 0) }}>
                <Icon name="branch" size={13} />
                <span className={s.name}>{b}</span>
                {b === refs[picking.repoId]?.default && <span className={s.muted}>default</span>}
                {b === refs[picking.repoId]?.branch && <span className={s.muted}>checked out</span>}
              </div>
            ))}
            {choices.length === 0 && <div className={s.empty}>No branch matches “{picking.query}”.</div>}
          </div>
        ) : (
        <div className={s.list} role="listbox" aria-label="Where the session runs">
          {targets.map((t, i) => {
            const on = i === current
            const gap = grouped && t.type === 'checkout' && !t.worktree && i > 0
            return (
              <div key={t.key} ref={on ? rowRef : undefined} role="option" aria-selected={on}
                className={cx(s.row, on && s.on, gap && s.gap, grouped && (t.type === 'create' || (t.type === 'checkout' && t.worktree)) && s.nested)}
                onClick={() => choose(t)}>
                {t.type === 'create' ? (
                  <>
                    <Icon name="plus" size={13} />
                    <span className={s.name}>{t.branch ? <>New worktree <b>{t.branch}</b></> : 'New worktree'}</span>
                    <span className={s.muted}>from {t.base ?? 'HEAD'}</span>
                    {(!grouped && repos > 1) && <span className={s.where}>in {t.repo.name}</span>}
                  </>
                ) : t.worktree ? (
                  <>
                    <Icon name="branch" size={13} />
                    <span className={s.name}>{t.branch}</span>
                    {!grouped && <span className={s.where}>in {t.repo.name}</span>}
                  </>
                ) : (
                  <>
                    <Icon name="folder" size={13} />
                    <span className={s.name}>{t.repo.name}</span>
                    {t.branch && <span className={s.muted}><Icon name="branch" size={11} /> {t.branch}</span>}
                    <span className={s.where}>{tidyPath(t.repo.path)}</span>
                  </>
                )}
              </div>
            )
          })}
          {targets.length === 0 && <div className={s.empty}>No projects yet.</div>}
        </div>
        )}

        {error && <div className={s.error}>{error}</div>}

        <div className={s.controls}>
          <div className={s.kinds} role="group" aria-label="Agent">
            {KINDS.map((k) => (
              <button key={k.kind} type="button" tabIndex={-1} className={cx(s.kind, kind === k.kind && s.kindOn)}
                aria-pressed={kind === k.kind} onClick={() => setPicked(k.kind)}>
                <Icon name={k.icon} size={13} />{k.label}<kbd>⌥{k.key}</kbd>
              </button>
            ))}
          </div>
          <span className={s.sandbox}>
            <SandboxToggle kind={kind} checked={sandboxed} onChange={onSandbox} />
            <kbd>⌥S</kbd>
          </span>
        </div>

        {target?.type === 'create' && (
          <input ref={branchRef} className={s.label} value={branchShown} placeholder={`Branch — ${proposal} (Tab)`} aria-label="Branch name"
            onChange={(e) => setEdit({ key: target.key, value: e.target.value })} />
        )}

        {/* its own line: beside the switch it got whatever width the agent buttons left over */}
        <input ref={labelRef} className={s.label} value={label} placeholder="Label — a name for this session (Tab)" aria-label="Label"
          onChange={(e) => setLabel(e.target.value)} />

        {/* what ↵ will do, spelled out — including the part of a sandbox that is not a promise (ADR 0036) */}
        <div className={s.summary}>
          <span className={s.what}>
            {busy ? 'Working…' : target && `${verb} ${where} · ${isolated ? 'sandboxed — files only, network is open' : 'on your host'}`}
          </span>
          {target?.type === 'create' && !picking && <span><kbd>⌥B</kbd> pick base</span>}
          <span><kbd>↵</kbd> {picking ? 'fork this' : verb.toLowerCase()}</span>
        </div>
      </div>
    </Modal>
  )
}
