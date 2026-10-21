import { useEffect, useRef } from 'react'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from '@codemirror/view'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { minimalSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import s from './ScratchpadEditor.module.css'

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', background: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: 'var(--sp-3)', caretColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--card-selected-bg)' },
  '.cm-h': { fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-bold)', color: 'var(--text)' },
  '.cm-h1': { fontSize: '1.45em', paddingTop: 'var(--sp-3)' },
  '.cm-h2': { fontSize: '1.25em', paddingTop: 'var(--sp-2)' },
  '.cm-h3': { fontSize: '1.1em', paddingTop: 'var(--sp-1)' },
  '.cm-h-mark': { color: 'var(--text-3)', fontWeight: 'var(--fw-regular)' },
  '.cm-strong': { fontWeight: 'var(--fw-bold)', color: 'var(--text)' },
  '.cm-strong-mark': { color: 'var(--text-3)' },
  '.cm-bullet': { color: 'var(--accent)', fontWeight: 'var(--fw-bold)' },
  '.cm-task-done': { color: 'var(--text-2)', textDecoration: 'line-through' },
  '.cm-task-box': {
    appearance: 'none', width: '1.05em', height: '1.05em', margin: '0 0.5em 0 0', verticalAlign: '-0.18em',
    border: '1.5px solid var(--text-2)', borderRadius: '4px', background: 'transparent', cursor: 'pointer',
    display: 'inline-grid', placeContent: 'center', padding: 0,
  },
  '.cm-task-box:hover': { borderColor: 'var(--accent)' },
  '.cm-task-box:checked': { background: 'var(--accent)', borderColor: 'var(--accent)' },
  '.cm-task-box:checked::after': { content: '"✓"', color: 'var(--raised-bg)', fontSize: '0.8em', lineHeight: 1, fontWeight: 'var(--fw-bold)' },
}, { dark: true })

class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(o: CheckboxWidget) { return o.checked === this.checked }
  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.className = 'cm-task-box'
    el.checked = this.checked
    // mousedown (not click) so CodeMirror does not move the caret first; the doc stays the source of truth.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(el)
      const line = view.state.doc.lineAt(pos)
      const m = TASK.exec(line.text)
      if (!m) return
      const at = line.from + m[1].length + m[2].length + 2 // the char inside [ ]
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } })
    })
    return el
  }
  ignoreEvent() { return true }
}

const TASK = /^(\s*)([-*+]) \[( |x|X)\] /
const BULLET = /^(\s*)([-*+]) /
const HEADING = /^(#{1,6}) /
const STRONG = /\*\*(?=\S)(.+?)\*\*/g

// Live styling over plain markdown: only decorations, the document text is never rewritten.
function decorate(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)
  const inCode = (pos: number) => /Code/.test(tree.resolveInner(pos, 1).name)
  let last = -1
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      pos = line.to + 1
      if (line.from <= last) continue
      last = line.from
      if (inCode(line.from)) continue
      const text = line.text
      const parts: { from: number; to: number; deco: Decoration }[] = []
      let task: RegExpExecArray | null
      let m: RegExpExecArray | null
      if ((task = TASK.exec(text))) {
        const done = task[3] !== ' '
        const lead = task[0].length
        b.add(line.from, line.from, Decoration.line({
          class: done ? 'cm-task-done' : '',
          attributes: { style: `padding-left:${lead}ch;text-indent:-${lead}ch` },
        }))
        parts.push({ from: line.from + task[1].length, to: line.from + lead, deco: Decoration.replace({ widget: new CheckboxWidget(done) }) })
      } else if ((m = BULLET.exec(text))) {
        const lead = m[0].length
        b.add(line.from, line.from, Decoration.line({ attributes: { style: `padding-left:${lead}ch;text-indent:-${lead}ch` } }))
        parts.push({ from: line.from + m[1].length, to: line.from + m[1].length + 1, deco: Decoration.replace({ widget: new BulletWidget() }) })
      } else if ((m = HEADING.exec(text))) {
        const level = Math.min(m[1].length, 3)
        b.add(line.from, line.from, Decoration.line({ class: `cm-h cm-h${level}` }))
        parts.push({ from: line.from, to: line.from + m[1].length, deco: Decoration.mark({ class: 'cm-h-mark' }) })
      }
      STRONG.lastIndex = 0
      while ((m = STRONG.exec(text))) {
        const s = line.from + m.index
        const e = s + m[0].length
        if (inCode(s)) continue
        parts.push({ from: s, to: s + 2, deco: Decoration.mark({ class: 'cm-strong-mark' }) })
        parts.push({ from: s + 2, to: e - 2, deco: Decoration.mark({ class: 'cm-strong' }) })
        parts.push({ from: e - 2, to: e, deco: Decoration.mark({ class: 'cm-strong-mark' }) })
      }
      parts.sort((a, c) => a.from - c.from || a.to - c.to)
      let end = -1
      for (const p of parts) {
        if (p.from < end) continue // overlapping (e.g. bold marker inside a replaced range)
        b.add(p.from, p.to, p.deco)
        end = p.to
      }
    }
  }
  return b.finish()
}

const liveMarkdown = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = decorate(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = decorate(u.view)
  }
}, { decorations: (v) => v.decorations })

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
          minimalSetup, markdown(), liveMarkdown, EditorView.lineWrapping, theme,
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
