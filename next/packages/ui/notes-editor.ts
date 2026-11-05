import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap, placeholder } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { slashMenu } from './slash-menu.ts'

// The notes editor: plain markdown in CodeMirror, drawn the way it reads. Headings, bold, italic, strike, code, links, quotes, rules,
// bullets and check boxes are decorations over the text, and the syntax marks hide until the caret is in them. The document text is
// never rewritten, so what is saved is exactly what was typed.
export interface NotesEditorHandlers {
  onChange(text: string): void
  onSave(): void
  onClose(): void
}

export interface NotesEditor {
  focus(): void
  destroy(): void
}

const TASK = /^(\s*)([-*+]) \[( |x|X)\] /
const MARK_WIDTH = 2.2 // characters a drawn bullet or check box stands for in place of its mark and space; the CSS widget is as wide

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-task'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task-box'
    box.checked = this.checked
    // mousedown, not click, so the caret does not move first; the document stays the source of truth.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(wrap))
      const match = TASK.exec(line.text)
      if (!match) return
      const at = line.from + match[1].length + 3 // the character inside [ ]
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } })
    })
    wrap.append(box)
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() })
const hidden = Decoration.replace({})
const checkbox = (checked: boolean): Decoration => Decoration.replace({ widget: new CheckboxWidget(checked) })
const mark = (name: string): Decoration => Decoration.mark({ class: name })

const hangingIndent = (characters: number, className = ''): Decoration =>
  Decoration.line({ class: className, attributes: { style: `padding-left:calc(${characters}ch + var(--space-2));text-indent:-${characters}ch` } })

function decorate(view: EditorView): DecorationSet {
  const { doc, selection } = view.state
  const out: Range<Decoration>[] = []
  const touches = (from: number, to: number): boolean => selection.ranges.some((range) => range.from <= to && range.to >= from)
  const lineClass = (from: number, to: number, names: (index: number, last: number) => string): void => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    for (let n = first; n <= last; n++) out.push(Decoration.line({ class: names(n - first, last - first) }).range(doc.line(n).from))
  }
  // A replaced range may not cross a line break when it comes from a plugin, so a mark that would is left showing.
  const hide = (from: number, to: number): void => {
    if (to > from && doc.lineAt(from).number === doc.lineAt(to).number) out.push(hidden.range(from, to))
  }
  const dimOrHide = (from: number, to: number, owner: { from: number; to: number }): void => {
    if (touches(owner.from, owner.to)) out.push(mark('cm-mark').range(from, to))
    else hide(from, to)
  }

  const first = view.visibleRanges[0]?.from ?? 0
  const last = view.visibleRanges.at(-1)?.to ?? doc.length
  syntaxTree(view.state).iterate({
    from: first,
    to: last,
    enter: (node) => {
      const name = node.name
      const heading = /^ATXHeading([1-6])$/.exec(name)
      if (heading) {
        out.push(Decoration.line({ class: `cm-h cm-h${Math.min(Number(heading[1]), 3)}` }).range(doc.lineAt(node.from).from))
      } else if (name === 'HeaderMark' && node.node.parent?.name.startsWith('ATX')) {
        const line = doc.lineAt(node.from)
        const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
        dimOrHide(node.from, end, line)
      } else if (name === 'StrongEmphasis') out.push(mark('cm-strong').range(node.from, node.to))
      else if (name === 'Emphasis') out.push(mark('cm-em').range(node.from, node.to))
      else if (name === 'Strikethrough') out.push(mark('cm-strike').range(node.from, node.to))
      else if (name === 'InlineCode') out.push(mark('cm-code-inline').range(node.from, node.to))
      else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || (name === 'CodeMark' && node.node.parent?.name === 'InlineCode')) {
        dimOrHide(node.from, node.to, node.node.parent ?? node)
      } else if (name === 'FencedCode') {
        lineClass(node.from, node.to, (i, end) => `cm-codeblock${i === 0 ? ' cm-codeblock-first' : ''}${i === end ? ' cm-codeblock-last' : ''}`)
        for (const child of [...node.node.getChildren('CodeMark'), ...node.node.getChildren('CodeInfo')]) out.push(mark('cm-mark').range(child.from, child.to))
        return false // the code inside stays as typed
      } else if (name === 'Blockquote') lineClass(node.from, node.to, () => 'cm-quote')
      else if (name === 'QuoteMark') out.push(mark('cm-mark').range(node.from, node.to))
      else if (name === 'HorizontalRule') {
        out.push(Decoration.line({ class: 'cm-hr' }).range(doc.lineAt(node.from).from))
        if (!touches(node.from, node.to)) out.push(mark('cm-hr-text').range(node.from, node.to))
      } else if (name === 'Link') {
        const marks = node.node.getChildren('LinkMark')
        const [open, close] = marks
        if (open && close) {
          out.push(mark('cm-link').range(open.to, close.from))
          if (touches(node.from, node.to)) {
            for (const m of marks) out.push(mark('cm-mark').range(m.from, m.to))
            const url = node.node.getChild('URL')
            if (url) out.push(mark('cm-link-url').range(url.from, url.to))
          } else {
            hide(open.from, open.to)
            hide(close.from, node.to)
          }
        }
        return false
      } else if (name === 'URL' && node.node.parent?.name !== 'Link') out.push(mark('cm-link').range(node.from, node.to))
      else if (name === 'ListMark') {
        const line = doc.lineAt(node.from)
        const lead = node.from - line.from
        const task = TASK.exec(line.text)
        if (task && task[1].length === lead) {
          const done = task[3] !== ' '
          const from = line.from + lead
          out.push(checkbox(done).range(from, line.from + task[0].length))
          out.push(hangingIndent(lead + MARK_WIDTH, done ? 'cm-task-done' : '').range(line.from))
        } else if (/^[-*+]$/.test(doc.sliceString(node.from, node.to)) && doc.sliceString(node.to, node.to + 1) === ' ') {
          out.push(bullet.range(node.from, node.to + 1))
          out.push(hangingIndent(lead + MARK_WIDTH).range(line.from))
        } else {
          out.push(mark('cm-ordered').range(node.from, node.to))
          out.push(hangingIndent(node.to + 1 - line.from).range(line.from))
        }
      }
      return undefined
    },
  })
  return Decoration.set(out, true)
}

const liveMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorate(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = decorate(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // The caret steps over a drawn bullet or box in one go, and one Backspace removes it.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
)

// Uncontrolled: the document lives in CodeMirror and the owner is told about every change. The caret starts at the end, where a new line goes.
export function createNotesEditor(parent: HTMLElement, text: string, handlers: NotesEditorHandlers): NotesEditor {
  const view = new EditorView({
    parent,
    doc: text,
    selection: { anchor: text.length },
    extensions: [
      history(),
      markdown({ extensions: GFM, addKeymap: false }),
      keymap.of([
        { key: 'Mod-s', run: () => (handlers.onSave(), true) },
        { key: 'Escape', run: () => (handlers.onClose(), true) },
        ...markdownKeymap,
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      liveMarkdown,
      slashMenu,
      EditorView.lineWrapping,
      placeholder('Jot something down…'),
      EditorView.contentAttributes.of({ 'aria-label': 'Notes', spellcheck: 'true' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) handlers.onChange(update.state.doc.toString())
      }),
    ],
  })
  view.focus()
  view.dispatch({ effects: EditorView.scrollIntoView(text.length, { y: 'end' }) })
  return { focus: () => view.focus(), destroy: () => view.destroy() }
}
