import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

// The notes editor's slash menu: "/" at the start of a line, or right after a list marker, lists block types. A pick replaces the "/"
// and the marker with the block's markdown prefix, so the document stays plain markdown.
export interface SlashItem {
  label: string
  detail: string
  insert: string
  glyph: string // what the item's tile shows: text, or the inner markup of a stroke icon on a 24-unit grid
  icon?: true
}

export const SLASH_ITEMS: SlashItem[] = [
  { label: 'Heading 1', detail: '#', insert: '# ', glyph: 'H1' },
  { label: 'Heading 2', detail: '##', insert: '## ', glyph: 'H2' },
  { label: 'Heading 3', detail: '###', insert: '### ', glyph: 'H3' },
  { label: 'Bullet list', detail: '-', insert: '- ', glyph: '<circle cx="5" cy="7" r="1.2" /><circle cx="5" cy="12" r="1.2" /><circle cx="5" cy="17" r="1.2" /><path d="M10 7h10M10 12h10M10 17h10" />', icon: true },
  { label: 'Checkbox', detail: '- [ ]', insert: '- [ ] ', glyph: '<rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" />', icon: true },
  { label: 'Quote', detail: '>', insert: '> ', glyph: '<path d="M6 5v14" /><path d="M11 9h8M11 15h6" />', icon: true },
  { label: 'Divider', detail: '---', insert: '---\n', glyph: '<path d="M4 12h16" />', icon: true },
]

// Indentation, then an optional list marker (with an optional check box), then "/" and what has been typed of the name.
const TRIGGER = /^(\s*)(?:(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?)?\/([\w ]*)$/

// `before` is the line's text up to the caret. Returns where the replaced range starts in it, and the items that match, or null.
export function slashMatch(before: string): { offset: number; items: SlashItem[] } | null {
  const match = TRIGGER.exec(before)
  if (!match) return null
  const query = match[2].trim().toLowerCase()
  const items = SLASH_ITEMS.filter((item) => item.label.toLowerCase().includes(query))
  return items.length > 0 ? { offset: match[1].length, items } : null
}

function slashSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const found = slashMatch(line.text.slice(0, context.pos - line.from))
  if (!found) return null
  const from = line.from + found.offset
  return {
    from,
    filter: false, // slashMatch already filtered; the typed text includes the marker and "/", which no label starts with
    options: found.items.map((item) => ({
      label: item.label,
      detail: item.detail,
      type: item.icon ? 'icon' : 'text',
      apply: (view, _completion, start, end) =>
        view.dispatch({ changes: { from: start, to: end, insert: item.insert }, selection: { anchor: start + item.insert.length }, userEvent: 'input.complete' }),
    })),
  }
}

// The tile in front of each label shows the block's shape, so the list reads as a preview of what it makes.
const tile = {
  render(completion: Completion): Node | null {
    const item = SLASH_ITEMS.find((candidate) => candidate.label === completion.label)
    if (!item) return null
    const el = document.createElement('span')
    el.className = 'slash-tile'
    if (item.icon) el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.glyph}</svg>`
    else el.textContent = item.glyph
    return el
  },
  position: 20,
}

export const slashMenu = autocompletion({ override: [slashSource], icons: false, closeOnBlur: true, addToOptions: [tile] })
