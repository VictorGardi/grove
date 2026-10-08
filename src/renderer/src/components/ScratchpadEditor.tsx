import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { minimalSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import s from './ScratchpadEditor.module.css'

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', background: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: 'var(--sp-3)', caretColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--card-selected-bg)' },
}, { dark: true })

interface Props {
  initialValue: string
  onChange: (v: string) => void
  onSave: () => void
}

// Uncontrolled: the doc lives in CodeMirror; the parent is told about every change. Callbacks go through a ref so
// the editor is created once and never torn down by a re-render.
export function ScratchpadEditor({ initialValue, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          minimalSetup, markdown(), EditorView.lineWrapping, theme,
          keymap.of([{ key: 'Mod-s', run: () => { cb.current.onSave(); return true } }]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()) }),
        ],
      }),
    })
    view.focus()
    return () => view.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- initialValue seeds the doc once

  return <div ref={host} className={s.editor} />
}
