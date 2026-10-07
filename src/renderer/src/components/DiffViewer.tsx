import type { CSSProperties } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { Comment, DiffFile, SessionDiff } from '@shared/types'
import { allCollapsed, lineKey, rangeAnchor, selectionRange, sideOf, toggleAll, toggleOne, visibleFiles, type DraftRange } from '../diffView'
import { draftsByLine } from '../reviewView'
import { useSlices } from '../stores/slices'
import { CommentEditor } from './CommentEditor'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import s from './DiffViewer.module.css'

type Draft = DraftRange

const STATUS: Record<DiffFile['status'], string> = {
  modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', untracked: 'Untracked',
}

// The session diff, drawn as text nodes only (D1). The body never remounts, so scroll survives updates.
export function DiffViewer({ diff, sessionId, label, expanded, onOpenRendered, onToggleExpanded, onClose }: {
  diff: SessionDiff | null
  sessionId: string
  label: string
  expanded: boolean
  onOpenRendered: (projectId: string, r: NonNullable<DiffFile['rendered']>) => void
  onToggleExpanded: () => void
  onClose: () => void
}) {
  const d = diff && diff.sessionId === sessionId ? diff : null
  const [showUntracked, setShowUntracked] = useState(true)
  const files = d ? visibleFiles(d, showUntracked) : []
  // collapsed file paths, per session: another session's diff starts expanded
  const [fold, setFold] = useState<{ sessionId: string; paths: Set<string> }>({ sessionId, paths: new Set() })
  const collapsed = fold.sessionId === sessionId ? fold.paths : new Set<string>()
  const folded = allCollapsed(collapsed, files)
  const comments = useSlices((x) => x.comments).filter((c) => c.sessionId === sessionId)
  const [writing, setWriting] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<{ range: Draft; x: number; y: number } | null>(null) // a text selection's Comment button
  const filesRef = useRef(files)
  filesRef.current = files

  // A text selection over diff lines offers a Comment button beside it.
  useEffect(() => {
    const rowOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-li]') ?? null
    const ref = (el: HTMLElement) => ({ path: el.dataset.path!, hunk: Number(el.dataset.hunk), li: Number(el.dataset.li) })
    const onChange = () => {
      const sel = document.getSelection()
      const range = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
      let a = range && body.current?.contains(range.commonAncestorContainer) ? rowOf(range.startContainer) : null
      let b = range ? rowOf(range.endContainer) : null
      // a whole-line selection ends at offset 0 of the next row: that row is not part of it
      if (range && a && b && a !== b && range.endOffset === 0) {
        let prev = b.previousElementSibling
        while (prev && !(prev instanceof HTMLElement && prev.dataset.li)) prev = prev.previousElementSibling
        b = prev as HTMLElement | null
      }
      const file = a && filesRef.current.find((f) => f.path === a!.dataset.path)
      const r = file && a && b ? selectionRange(file, ref(a), ref(b)) : null
      if (!r || !range) return setPicked(null)
      // above the start of the selection: its bounding box can reach far right on wide lines
      const first = range.getClientRects()[0] ?? range.getBoundingClientRect()
      setPicked({ range: r, x: Math.min(first.left, window.innerWidth - 90), y: Math.max(first.top, 40) })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  async function save(file: DiffFile, body: string) {
    const a = writing && d?.root ? rangeAnchor(d.root, file, writing.hunk, writing.side, writing.origin, writing.end) : null
    if (!a) return
    const res = await window.api.invoke('comment:add', { sessionId, anchor: a, body })
    if (res.ok) {
      setWriting(null)
      setError(null)
    } else setError(res.error)
  }
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        <div className={s.title}>
          <span className={s.label}>Diff · {label}</span>
          {d?.root && <span className={s.root}>{d.root}</span>}
        </div>
        <label className={s.toggle}>
          <input type="checkbox" checked={showUntracked} onChange={(e) => setShowUntracked(e.target.checked)} />
          Untracked
        </label>
        <Button variant="ghost" size="sm" icon={folded ? 'chevrons-up-down' : 'chevrons-down-up'} round
          disabled={files.length === 0} aria-label={folded ? 'Expand all files' : 'Collapse all files'}
          title={folded ? 'Expand all files' : 'Collapse all files'}
          onClick={() => setFold({ sessionId, paths: toggleAll(collapsed, files) })} />
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <div ref={body} className={s.body} onScroll={() => setPicked(null)}>
        {d?.truncated && <div className={s.notice}>Diff too large: later files are listed without their lines</div>}
        {!d ? <div className={s.note}>Loading…</div>
          : d.state === 'not-git' ? <div className={s.note}>Not a git repository</div>
          : d.state === 'error' ? <div className={s.note}>{d.error}</div>
          : files.length === 0 ? <div className={s.note}>No changes</div>
          : files.map((f) => (
            <FileSection key={f.path} file={f} collapsed={collapsed.has(f.path)} drafts={draftsByLine(comments, f.path)}
              writing={writing?.path === f.path ? writing : null} error={error}
              onWrite={(next) => { setError(null); setWriting(next) }} onSave={(body) => save(f, body)} onCancel={() => setWriting(null)}
              onToggle={() => setFold({ sessionId, paths: toggleOne(collapsed, f.path) })}
              onOpenRendered={(r) => onOpenRendered(d.projectId, r)} />
          ))}
      </div>
      {picked && (
        <button type="button" className={s.pick} style={{ '--x': `${picked.x}px`, '--y': `${picked.y}px` } as CSSProperties}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setError(null)
            setWriting(picked.range)
            setPicked(null)
            document.getSelection()?.removeAllRanges()
          }}>Comment</button>
      )}
    </div>
  )
}

function FileSection({ file, collapsed, drafts, writing, error, onWrite, onSave, onCancel, onToggle, onOpenRendered }: {
  file: DiffFile
  collapsed: boolean
  drafts: Map<string, Comment[]>
  writing: Draft | null
  error: string | null
  onWrite: (d: Draft) => void
  onSave: (body: string) => void
  onCancel: () => void
  onToggle: () => void
  onOpenRendered: (r: NonNullable<DiffFile['rendered']>) => void
}) {
  const { rendered } = file
  return (
    <section className={s.file}>
      <div className={s.fileHeader} onClick={onToggle}>
        <button type="button" className={s.fold} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
          <span className={s.status}>{STATUS[file.status]}</span>
          <span className={s.path}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
          <span className={s.add}>+{file.additions}</span>
          <span className={s.del}>−{file.deletions}</span>
        </button>
        {rendered && <Button variant="ghost" size="sm" className={s.open} onClick={(e) => { e.stopPropagation(); onOpenRendered(rendered) }}>Open rendered</Button>}
      </div>
      {collapsed ? null
        : file.binary ? <div className={s.note}>Binary file</div>
        : file.truncated ? <div className={s.note}>Too large to show</div>
        : file.hunks.map((h, hi) => (
        <div key={`${hi}:${h.header}`} className={s.hunk}>
          <div className={s.hunkHeader}>{h.header}</div>
          {h.lines.map((l, li) => {
            const key = lineKey(file.path, l)
            const side = sideOf(l)
            const here = writing?.hunk === hi && writing.side === side
            const inRange = here && li >= Math.min(writing.origin, writing.end) && li <= Math.max(writing.origin, writing.end)
            // a shift-click in the same hunk and side extends the range; any other click starts one
            const start = (e: React.MouseEvent) => onWrite(e.shiftKey && here
              ? { ...writing, end: li }
              : { path: file.path, hunk: hi, side, origin: li, end: li })
            return (
              <Fragment key={key}>
                <div data-path={file.path} data-hunk={hi} data-li={li} className={`${s.line} ${l.kind === 'add' ? s.lineAdd : l.kind === 'del' ? s.lineDel : ''} ${inRange ? s.lineSelected : ''}`}>
                  <button type="button" className={s.plus} aria-label={`Comment on line ${(side === 'old' ? l.old : l.new) ?? ''}`} onClick={start}>+</button>
                  <span className={s.num}>{l.old ?? ''}</span>
                  <span className={s.num}>{l.new ?? ''}</span>
                  <span className={s.sign}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                  <span className={s.text}>{l.text}</span>
                </div>
                {here && Math.max(writing.origin, writing.end) === li && (
                  <div className={s.block}>
                    <CommentEditor key={`${writing.path}:${writing.hunk}:${writing.side}:${writing.origin}`} error={error} onSave={onSave} onCancel={onCancel} />
                  </div>
                )}
                {drafts.get(key)?.map((c) => <DraftBlock key={c.id} comment={c} />)}
              </Fragment>
            )
          })}
        </div>
      ))}
    </section>
  )
}

// A saved draft under its last line: its body, with Edit and Delete.
function DraftBlock({ comment }: { comment: Comment }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(body: string) {
    const res = await window.api.invoke('comment:update', { id: comment.id, body })
    if (res.ok) setEditing(false)
    else setError(res.error)
  }
  return (
    <div className={s.block}>
      {editing ? <CommentEditor initial={comment.body} error={error} onSave={(b) => void save(b)} onCancel={() => setEditing(false)} /> : (
        <div className={s.draft}>
          <div className={s.draftBody}>{comment.body}</div>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => void window.api.invoke('comment:delete', { id: comment.id })}>Delete</Button>
        </div>
      )}
    </div>
  )
}
