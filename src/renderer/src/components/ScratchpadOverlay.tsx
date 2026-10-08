import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './ui/Modal'
import { Banner } from './ui/Banner'
import { Button } from './ui/Button'
import { ScratchpadEditor } from './ScratchpadEditor'
import s from './ScratchpadOverlay.module.css'

const SAVE_DELAY_MS = 500

// Global notes (⌘N): one markdown file in userData, autosaved while typing and on close. The editor is only
// mounted once the file has loaded, so a failed or slow read can never be saved over the notes.
export function ScratchpadOverlay({ onClose }: { onClose: () => void }) {
  const [initial, setInitial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const content = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  useEffect(() => {
    window.api.invoke('notes:read').then((res) => {
      if (res.ok) { content.current = res.data; setInitial(res.data) }
      else setError(`Failed to load: ${res.error}`)
    })
  }, [])

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    if (content.current === null) return
    setSaving(true)
    const res = await window.api.invoke('notes:write', { content: content.current })
    setSaving(false)
    if (res.ok) { dirty.current = false; setError(null) } else setError(`Failed to save: ${res.error}`)
  }, [])

  const edit = useCallback((v: string) => {
    content.current = v
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
  }, [save])

  const close = useCallback(() => {
    if (dirty.current) void save()
    onClose()
  }, [save, onClose])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <Modal onClose={close} width="lg">
      <div className={s.overlay}>
        <div className={s.header}>
          <h2>Scratchpad</h2>
          <div className={s.actions}>
            <Button variant="ghost" size="sm" onClick={() => void save()} disabled={saving || initial === null}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" size="sm" onClick={close}>Close</Button>
          </div>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        {initial !== null && <ScratchpadEditor initialValue={initial} onChange={edit} onSave={() => void save()} />}
        <div className={s.footer}><kbd>⌘N</kbd> or <kbd>Esc</kbd> to close · <kbd>⌘S</kbd> to save</div>
      </div>
    </Modal>
  )
}
