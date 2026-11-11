// The markdown preview: a file's text drawn as a document, read only. It is built from the same GFM parse the notes use, and only ever
// makes elements and text nodes, never markup from a string, so nothing in the file can run. Raw HTML shows as the text it is (comments
// are dropped), a link is drawn only for a web or mail address, and an image is its alt text: nothing is loaded.
import { GFM, parser } from '@lezer/markdown'

type SyntaxNode = ReturnType<typeof parser.parse>['topNode']

const LINKABLE = /^(https?:|mailto:)/i
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const HEADING = /^(?:ATX|Setext)Heading([1-6])$/
// Syntax the reader should not see: the characters that make a structure, not its content.
const MARKS = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'QuoteMark', 'ListMark', 'TaskMarker', 'TableDelimiter'])

const labelKey = (label: string): string => label.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase()

function decodeEntity(raw: string): string {
  const named = ENTITIES[raw.slice(1, -1)]
  if (named !== undefined) return named
  const numeric = /^&#(?:x([0-9a-f]+)|(\d+));$/i.exec(raw)
  if (!numeric) return raw
  const code = numeric[1] ? parseInt(numeric[1], 16) : parseInt(numeric[2], 10)
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
}

export function renderMarkdown(source: string, doc: Document = document): HTMLElement {
  const root = doc.createElement('div')
  root.className = 'md'
  const tree = parser.configure(GFM).parse(source)
  const slice = (from: number, to: number): string => source.slice(from, to)
  const nodeText = (node: SyntaxNode): string => slice(node.from, node.to)
  const children = (node: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) out.push(child)
    return out
  }
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, into: Node): HTMLElementTagNameMap[K] => into.appendChild(doc.createElement(tag))
  const text = (value: string, into: Node): void => void (value !== '' && into.appendChild(doc.createTextNode(value)))

  // Link definitions, so `[text][label]` and `[label]` can find their address.
  const definitions = new Map<string, string>()
  for (const node of children(tree.topNode)) {
    if (node.name !== 'LinkReference') continue
    const label = node.getChild('LinkLabel')
    const url = node.getChild('URL')
    if (label && url) definitions.set(labelKey(nodeText(label)), nodeText(url))
  }

  // The text of `node` between `from` and `to`, with the structure's own marks left out and the gaps kept as text.
  function inline(node: SyntaxNode, into: Node, from = node.from, to = node.to): void {
    let at = from
    for (const child of children(node)) {
      if (child.to <= from || child.from >= to) continue
      text(slice(at, child.from), into)
      inlineNode(child, into)
      at = child.to
    }
    text(slice(at, to), into)
  }

  function address(node: SyntaxNode): { url: string | null; title: string | null } {
    const url = node.getChild('URL')
    const title = node.getChild('LinkTitle')
    if (url) return { url: nodeText(url), title: title ? nodeText(title).slice(1, -1) : null }
    // A reference: `[text][label]` names its label, `[label]` is its own.
    const label = node.getChild('LinkLabel')
    const key = label ? labelKey(nodeText(label)) : labelKey(nodeText(node))
    return { url: definitions.get(key) ?? null, title: null }
  }

  function link(url: string | null, title: string | null, into: Node): HTMLElement | null {
    if (url === null || !LINKABLE.test(url)) return null
    const a = make('a', into)
    a.setAttribute('href', url)
    if (title) a.setAttribute('title', title)
    a.setAttribute('rel', 'noopener noreferrer')
    return a
  }

  function inlineNode(node: SyntaxNode, into: Node): void {
    const name = node.name
    if (MARKS.has(name)) return
    if (name === 'Emphasis') return inline(node, make('em', into))
    if (name === 'StrongEmphasis') return inline(node, make('strong', into))
    if (name === 'Strikethrough') return inline(node, make('del', into))
    if (name === 'InlineCode') return text(slice(node.from, node.to).replace(/^`+|`+$/g, ''), make('code', into))
    if (name === 'HardBreak') return void make('br', into)
    if (name === 'Entity') return text(decodeEntity(nodeText(node)), into)
    if (name === 'Escape') return text(nodeText(node).slice(1), into)
    if (name === 'Image') {
      // The alt text is what sits between the first two marks, flattened to plain text; the address is never fetched.
      const marks = node.getChildren('LinkMark')
      const holder = make('span', into)
      holder.className = 'md-image'
      inline(node, holder, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to)
      holder.textContent = holder.textContent
      return
    }
    if (name === 'Link') {
      const marks = node.getChildren('LinkMark')
      const { url, title } = address(node)
      const a = link(url, title, into)
      const holder: Node = a ?? into
      return inline(node, holder, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to)
    }
    if (name === 'Autolink' || name === 'URL') {
      const target = nodeText(node.getChild('URL') ?? node).replace(/^<|>$/g, '')
      const a = link(target, null, into)
      return text(target, a ?? into)
    }
    if (name === 'Comment' || name === 'CommentBlock') return
    // Raw HTML, and anything not known here, is shown as the characters it is.
    return text(nodeText(node), into)
  }

  // Joins the text a skipped mark split, drops the spaces such a mark left at a line's start (code keeps all of its own), and trims the ends.
  function trimmed(el: HTMLElement): HTMLElement {
    const lines = (node: Node): void => {
      if (node.nodeType === 3) node.textContent = (node.textContent ?? '').replace(/\n[ \t]+/g, '\n')
      else if ((node as Element).tagName !== 'CODE') node.childNodes.forEach(lines)
    }
    el.normalize()
    lines(el)
    const first = el.firstChild
    const last = el.lastChild
    if (first?.nodeType === 3) first.textContent = (first.textContent ?? '').replace(/^\s+/, '')
    if (last?.nodeType === 3) last.textContent = (last.textContent ?? '').replace(/\s+$/, '')
    return el
  }

  // The code's lines as written: the pieces of text (an indent or a quote's mark between them is not code), one line break between two.
  function codeText(node: SyntaxNode): string {
    let out = ''
    for (const part of children(node)) {
      if (part.name !== 'CodeText') continue
      if (out !== '' && !out.endsWith('\n')) out += '\n'
      out += nodeText(part)
    }
    return out.replace(/\n$/, '')
  }

  function table(node: SyntaxNode, into: Node): void {
    const align: Array<string | null> = []
    const parts = children(node)
    const rule = parts.find((part) => part.name === 'TableDelimiter' && part.to - part.from > 1)
    if (rule) {
      for (const cell of nodeText(rule).split('|').map((c) => c.trim()).filter(Boolean)) {
        align.push(cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null)
      }
    }
    const t = make('table', into)
    const row = (rowNode: SyntaxNode, tag: 'th' | 'td', body: Node): void => {
      const tr = make('tr', body)
      for (const [i, cell] of rowNode.getChildren('TableCell').entries()) {
        const el = make(tag, tr)
        if (align[i]) el.style.textAlign = align[i]!
        inline(cell, el)
        trimmed(el)
      }
    }
    for (const part of parts) {
      if (part.name === 'TableHeader') row(part, 'th', make('thead', t))
    }
    const rows = parts.filter((part) => part.name === 'TableRow')
    if (rows.length > 0) {
      const body = make('tbody', t)
      for (const part of rows) row(part, 'td', body)
    }
  }

  function list(node: SyntaxNode, into: Node): void {
    const ordered = node.name === 'OrderedList'
    const el = make(ordered ? 'ol' : 'ul', into)
    if (ordered) {
      const start = parseInt(slice(node.getChild('ListItem')?.getChild('ListMark')?.from ?? 0, node.getChild('ListItem')?.getChild('ListMark')?.to ?? 0), 10)
      if (Number.isFinite(start) && start !== 1) el.setAttribute('start', String(start))
    }
    for (const item of node.getChildren('ListItem')) {
      const li = make('li', el)
      for (const part of children(item)) {
        if (part.name === 'Task') {
          const marker = part.getChild('TaskMarker')
          const box = make('input', li)
          box.setAttribute('type', 'checkbox')
          box.setAttribute('disabled', '')
          if (marker && /\[[xX]\]/.test(nodeText(marker))) box.setAttribute('checked', '')
          const p = make('p', li)
          inline(part, p)
          trimmed(p)
        } else block(part, li)
      }
    }
  }

  function block(node: SyntaxNode, into: Node): void {
    const name = node.name
    if (MARKS.has(name)) return
    const heading = HEADING.exec(name)
    if (heading) {
      const el = make(`h${heading[1]}` as 'h1', into)
      const marks = node.getChildren('HeaderMark')
      const atx = name.startsWith('ATX')
      inline(node, el, atx ? (marks[0]?.to ?? node.from) : node.from, atx ? (marks[1]?.from ?? node.to) : (marks[0]?.from ?? node.to))
      return void trimmed(el)
    }
    if (name === 'Paragraph') {
      const p = make('p', into)
      inline(node, p)
      return void trimmed(p)
    }
    if (name === 'BulletList' || name === 'OrderedList') return list(node, into)
    if (name === 'Blockquote') {
      const el = make('blockquote', into)
      for (const part of children(node)) block(part, el)
      return
    }
    if (name === 'FencedCode' || name === 'CodeBlock') {
      const code = make('code', make('pre', into))
      const info = node.getChild('CodeInfo')
      if (info && nodeText(info).trim()) code.setAttribute('data-lang', nodeText(info).trim())
      return text(codeText(node), code)
    }
    if (name === 'HorizontalRule') return void make('hr', into)
    if (name === 'Table') return table(node, into)
    if (name === 'LinkReference' || name === 'CommentBlock' || name === 'ProcessingInstructionBlock') return
    // Raw HTML blocks, and anything else, as the text they are.
    const p = make('p', into)
    p.className = 'md-raw'
    text(nodeText(node), p)
  }

  for (const node of children(tree.topNode)) block(node, root)
  return root
}
