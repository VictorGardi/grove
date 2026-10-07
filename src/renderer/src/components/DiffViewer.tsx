import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { Comment, DiffFile, DiffLine, SessionDiff } from '@shared/types'
import {
  filterFiles, gaps, lineKey, pickFile, rangeAnchor, selectionRange, sideOf, splitPath, splitRows, STATUS_LETTER, visibleFiles, wordMarks,
  type Cell, type DraftRange, type Gap, type Seg,
} from '../diffView'
import { draftsByLine } from '../reviewView'
import { useSlices } from '../stores/slices'
import { CommentEditor } from './CommentEditor'
import { ReviewMenu } from './ReviewTray'
import { Icon } from './ui/Icon'
import { Button } from './ui/Button'
import s from './DiffViewer.module.css'

type Draft = DraftRange

const STATUS: Record<DiffFile['status'], string> = {
  modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', untracked: 'Untracked',
}

// The session diff, one file at a time, drawn as text nodes only (D1). Expanded: a file list and
// side-by-side lines; in the narrow panel: a file switcher and unified lines.
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
  // the chosen file, per session: another session's diff starts on its first file
  const [chosen, setChosen] = useState<{ sessionId: string; path: string | null }>({ sessionId, path: null })
  const file = pickFile(files, chosen.sessionId === sessionId ? chosen.path : null)
  const at = file ? files.indexOf(file) : -1
  const choose = (path: string) => setChosen({ sessionId, path })
  const [filter, setFilter] = useState('')
  const comments = useSlices((x) => x.comments).filter((c) => c.sessionId === sessionId)
  const [writing, setWriting] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<{ range: Draft; x: number; y: number } | null>(null) // a text selection's Comment button
  const fileRef = useRef(file)
  fileRef.current = file

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
        const col = b.dataset.col // side by side: the previous line of the same column
        const cells = [...body.current!.querySelectorAll<HTMLElement>('[data-li]')].filter((e) => e.dataset.col === col)
        const k = cells.indexOf(b)
        b = k > 0 ? cells[k - 1] : null
      }
      const f = fileRef.current
      const r = f && a && b && a.dataset.path === f.path ? selectionRange(f, ref(a), ref(b)) : null
      if (!r || !range) return setPicked(null)
      // above the start of the selection: its bounding box can reach far right on wide lines
      const first = range.getClientRects()[0] ?? range.getBoundingClientRect()
      setPicked({ range: r, x: Math.min(first.left, window.innerWidth - 90), y: Math.max(first.top, 40) })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  // In side-by-side, a drag starting in one column selects only that column.
  const onMouseDown = (e: ReactMouseEvent) => {
    const col = (e.target as Element).closest<HTMLElement>('[data-col]')?.dataset.col
    if (body.current) body.current.dataset.sel = col ?? ''
  }

  async function save(f: DiffFile, text: string) {
    const a = writing && d?.root ? rangeAnchor(d.root, f, writing.hunk, writing.side, writing.origin, writing.end) : null
    if (!a) return
    const res = await window.api.invoke('comment:add', { sessionId, anchor: a, body: text })
    if (res.ok) {
      setWriting(null)
      setError(null)
    } else setError(res.error)
  }

  const nav = (to: number) => {
    if (files[to]) {
      choose(files[to].path)
      setWriting(null)
      body.current?.scrollTo({ top: 0 })
    }
  }
  const listed = filterFiles(files, filter)

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
        {files.length > 0 && (
          <div className={s.pager}>
            <span className={s.count}>{at + 1} / {files.length}</span>
            <Button variant="ghost" size="sm" icon="chevron-up" round aria-label="Previous file" disabled={at <= 0} onClick={() => nav(at - 1)} />
            <Button variant="ghost" size="sm" icon="chevron-down" round aria-label="Next file" disabled={at >= files.length - 1} onClick={() => nav(at + 1)} />
          </div>
        )}
        <ReviewMenu sessionId={sessionId} />
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <div className={s.main}>
        {expanded && files.length > 0 && (
          <aside className={s.list} aria-label="Changed files">
            <label className={s.filter}>
              <Icon name="search" size={14} />
              <input value={filter} placeholder="Filter files…" aria-label="Filter files" onChange={(e) => setFilter(e.target.value)} />
            </label>
            <ul className={s.files}>
              {listed.map((f) => {
                const { dir, name } = splitPath(f.path)
                return (
                  <li key={f.path}>
                    <button type="button" className={`${s.fileItem} ${f === file ? s.fileActive : ''}`} title={f.path} onClick={() => { choose(f.path); setWriting(null) }}>
                      <span className={`${s.letter} ${s[`st_${f.status}`]}`}>{STATUS_LETTER[f.status]}</span>
                      <span className={s.fileName}><span className={s.dir}>{dir}</span>{name}</span>
                      <span className={s.add}>+{f.additions}</span>
                      <span className={s.del}>−{f.deletions}</span>
                    </button>
                  </li>
                )
              })}
              {listed.length === 0 && <li className={s.none}>No match</li>}
            </ul>
          </aside>
        )}
        <div className={s.content}>
          {!expanded && files.length > 1 && (
            <select className={s.switcher} aria-label="File" value={file?.path ?? ''} onChange={(e) => { choose(e.target.value); setWriting(null) }}>
              {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </select>
          )}
          <div ref={body} className={s.body} data-sel="" onScroll={() => setPicked(null)} onMouseDown={onMouseDown}>
            {d?.truncated && <div className={s.notice}>Diff too large: later files are listed without their lines</div>}
            {!d ? <div className={s.note}>Loading…</div>
              : d.state === 'not-git' ? <div className={s.note}>Not a git repository</div>
              : d.state === 'error' ? <div className={s.note}>{d.error}</div>
              : !file ? <div className={s.note}>No changes</div>
              : (
                <FileView key={file.path} file={file} sessionId={sessionId} split={expanded} drafts={draftsByLine(comments, file.path)}
                  writing={writing?.path === file.path ? writing : null} error={error}
                  onWrite={(next) => { setError(null); setWriting(next) }} onSave={(text) => save(file, text)} onCancel={() => setWriting(null)}
                  onOpenRendered={(r) => onOpenRendered(d.projectId, r)} />
              )}
          </div>
        </div>
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

// One line's text, with the changed words marked.
function Text({ text, segs, kind }: { text: string; segs?: Seg[]; kind: DiffLine['kind'] }) {
  if (!segs) return <>{text}</>
  return <>{segs.map((g, i) => (g.changed ? <mark key={i} className={kind === 'add' ? s.wordAdd : s.wordDel}>{g.text}</mark> : g.text))}</>
}

// Unmodified lines read from the file on click: `from` is the new-file number of the first, old = new + delta.
interface Revealed { from: number; delta: number; lines: string[] }

function FileView({ file, sessionId, split, drafts, writing, error, onWrite, onSave, onCancel, onOpenRendered }: {
  file: DiffFile
  sessionId: string
  split: boolean
  drafts: Map<string, Comment[]>
  writing: Draft | null
  error: string | null
  onWrite: (d: Draft) => void
  onSave: (body: string) => void
  onCancel: () => void
  onOpenRendered: (r: NonNullable<DiffFile['rendered']>) => void
}) {
  const { rendered } = file
  // revealed gaps by hunk index; a new diff of this file starts them closed again
  const [open, setOpen] = useState<{ file: DiffFile; gaps: Record<number, Revealed> }>({ file, gaps: {} })
  const revealed = open.file === file ? open.gaps : {}
  const [gapError, setGapError] = useState<string | null>(null)
  const gapAt = new Map(gaps(file).map((g) => [g.index, g]))

  async function reveal(g: Gap) {
    setGapError(null)
    const res = await window.api.invoke('diff:lines', { sessionId, path: file.path, from: g.from, to: g.to })
    if (!res.ok) return setGapError(res.error)
    setOpen((cur) => ({ file, gaps: { ...(cur.file === file ? cur.gaps : {}), [g.index]: { from: g.from, delta: g.delta, lines: res.data } } }))
  }

  // the editor and the saved drafts that sit under a line
  function under(l: DiffLine, li: number, hi: number) {
    const side = sideOf(l)
    const here = writing?.hunk === hi && writing.side === side
    return (
      <>
        {here && Math.max(writing.origin, writing.end) === li && (
          <div className={s.block}>
            <CommentEditor key={`${writing.path}:${writing.hunk}:${writing.side}:${writing.origin}`} error={error} onSave={onSave} onCancel={onCancel} />
          </div>
        )}
        {drafts.get(lineKey(file.path, l))?.map((c) => <DraftBlock key={c.id} comment={c} />)}
      </>
    )
  }

  const inRange = (l: DiffLine, li: number, hi: number) => {
    const here = writing?.hunk === hi && writing.side === sideOf(l)
    return !!here && li >= Math.min(writing.origin, writing.end) && li <= Math.max(writing.origin, writing.end)
  }
  // a shift-click in the same hunk and side extends the range; any other click starts one
  const start = (e: ReactMouseEvent, l: DiffLine, li: number, hi: number) => {
    const here = writing?.hunk === hi && writing.side === sideOf(l)
    onWrite(e.shiftKey && here ? { ...writing, end: li } : { path: file.path, hunk: hi, side: sideOf(l), origin: li, end: li })
  }
  const plus = (l: DiffLine, li: number, hi: number) => (
    <button type="button" className={s.plus} aria-label={`Comment on line ${(sideOf(l) === 'old' ? l.old : l.new) ?? ''}`} onClick={(e) => start(e, l, li, hi)}>+</button>
  )

  function gapRows(hi: number) {
    const g = gapAt.get(hi)
    if (!g) return null
    const r = revealed[hi]
    if (!r) {
      return (
        <button type="button" className={s.gap} onClick={() => void reveal(g)}>
          <Icon name="chevrons-up-down" size={14} />
          {g.to - g.from + 1} unmodified {g.to - g.from === 0 ? 'line' : 'lines'}
        </button>
      )
    }
    return r.lines.map((text, k) => {
      const n = r.from + k
      return split ? (
        <div key={`g${hi}:${k}`} className={s.srow}>
          <div className={s.cell}><span className={s.pad} /><span className={s.num}>{n + r.delta}</span><span className={s.sign} /><span className={s.text}>{text}</span></div>
          <div className={s.cell}><span className={s.pad} /><span className={s.num}>{n}</span><span className={s.sign} /><span className={s.text}>{text}</span></div>
        </div>
      ) : (
        <div key={`g${hi}:${k}`} className={s.line}>
          <span className={s.pad} /><span className={s.num}>{n + r.delta}</span><span className={s.num}>{n}</span><span className={s.sign} /><span className={s.text}>{text}</span>
        </div>
      )
    })
  }

  function unifiedHunk(hi: number) {
    const lines = file.hunks[hi].lines
    const marks = wordMarks(lines)
    return lines.map((l, li) => (
      <Fragment key={`${hi}:${li}`}>
        <div data-path={file.path} data-hunk={hi} data-li={li}
          className={`${s.line} ${l.kind === 'add' ? s.lineAdd : l.kind === 'del' ? s.lineDel : ''} ${inRange(l, li, hi) ? s.lineSelected : ''}`}>
          {plus(l, li, hi)}
          <span className={s.num}>{l.old ?? ''}</span>
          <span className={s.num}>{l.new ?? ''}</span>
          <span className={s.sign}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          <span className={s.text}><Text text={l.text} segs={marks.get(li)} kind={l.kind} /></span>
        </div>
        {under(l, li, hi)}
      </Fragment>
    ))
  }

  function splitHunk(hi: number) {
    const lines = file.hunks[hi].lines
    const marks = wordMarks(lines)
    const cell = (c: Cell | null, col: 'left' | 'right', own: boolean) => {
      if (!c) return <div className={`${s.cell} ${s.empty}`} data-col={col} />
      const { line: l, li } = c
      const num = col === 'left' ? l.old : l.new
      return (
        <div className={`${s.cell} ${l.kind === 'add' ? s.lineAdd : l.kind === 'del' ? s.lineDel : ''} ${own && inRange(l, li, hi) ? s.lineSelected : ''}`}
          data-col={col} {...(own ? { 'data-path': file.path, 'data-hunk': hi, 'data-li': li } : {})}>
          {own ? plus(l, li, hi) : <span className={s.pad} />}
          <span className={s.num}>{num ?? ''}</span>
          <span className={s.sign}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          <span className={s.text}><Text text={l.text} segs={marks.get(li)} kind={l.kind} /></span>
        </div>
      )
    }
    return splitRows(lines).map((r, k) => (
      <Fragment key={`${hi}:${k}`}>
        <div className={s.srow}>
          {cell(r.left, 'left', r.left?.line.kind === 'del')}
          {cell(r.right, 'right', true)}
        </div>
        {r.left?.line.kind === 'del' && under(r.left.line, r.left.li, hi)}
        {r.right && under(r.right.line, r.right.li, hi)}
      </Fragment>
    ))
  }

  return (
    <section className={`${s.file} ${split ? s.fileSplit : ''}`}>
      <div className={s.fileHeader}>
        <span className={s.status}>{STATUS[file.status]}</span>
        <span className={s.path}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        <span className={s.add}>+{file.additions}</span>
        <span className={s.del}>−{file.deletions}</span>
        {rendered && <Button variant="ghost" size="sm" className={s.open} onClick={() => onOpenRendered(rendered)}>Open rendered</Button>}
      </div>
      {gapError && <div className={s.notice}>Could not read the lines: {gapError}</div>}
      {file.binary ? <div className={s.note}>Binary file</div>
        : file.truncated ? <div className={s.note}>Too large to show</div>
        : file.hunks.map((_, hi) => (
          <Fragment key={hi}>
            {gapRows(hi)}
            {split ? splitHunk(hi) : unifiedHunk(hi)}
          </Fragment>
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
