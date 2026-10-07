import type { DiffFile, SessionDiff } from '@shared/types'
import { Button } from './ui/Button'
import s from './DiffViewer.module.css'

const STATUS: Record<DiffFile['status'], string> = {
  modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', untracked: 'Untracked',
}

// The session diff, drawn as text nodes only (D1). The body never remounts, so scroll survives updates.
export function DiffViewer({ diff, sessionId, label, expanded, onToggleExpanded, onClose }: {
  diff: SessionDiff | null
  sessionId: string
  label: string
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
}) {
  const d = diff && diff.sessionId === sessionId ? diff : null
  return (
    <div className={s.viewer}>
      <div className={s.header}>
        <div className={s.title}>
          <span className={s.label}>Diff · {label}</span>
          {d?.root && <span className={s.root}>{d.root}</span>}
        </div>
        <Button variant="ghost" size="sm" icon={expanded ? 'minimize' : 'maximize'} round
          aria-label={expanded ? 'Collapse viewer' : 'Expand viewer'} onClick={onToggleExpanded} />
        <Button variant="ghost" size="sm" icon="x" round aria-label="Close viewer" onClick={onClose} />
      </div>
      <div className={s.body}>
        {!d ? <div className={s.note}>Loading…</div>
          : d.state === 'error' ? <div className={s.note}>{d.error}</div>
          : d.files.length === 0 ? <div className={s.note}>No changes</div>
          : d.files.map((f) => <FileSection key={f.path} file={f} />)}
      </div>
    </div>
  )
}

function FileSection({ file }: { file: DiffFile }) {
  return (
    <section className={s.file}>
      <div className={s.fileHeader}>
        <span className={s.status}>{STATUS[file.status]}</span>
        <span className={s.path}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        <span className={s.add}>+{file.additions}</span>
        <span className={s.del}>−{file.deletions}</span>
      </div>
      {file.binary ? <div className={s.note}>Binary file</div> : file.hunks.map((h, i) => (
        <div key={`${i}:${h.header}`} className={s.hunk}>
          <div className={s.hunkHeader}>{h.header}</div>
          {h.lines.map((l) => (
            <div key={`${file.path}:${l.kind}:${l.old}:${l.new}`} className={`${s.line} ${l.kind === 'add' ? s.lineAdd : l.kind === 'del' ? s.lineDel : ''}`}>
              <span className={s.num}>{l.old ?? ''}</span>
              <span className={s.num}>{l.new ?? ''}</span>
              <span className={s.sign}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
              <span className={s.text}>{l.text}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
