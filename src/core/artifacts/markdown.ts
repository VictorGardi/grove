import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { ARTIFACT_SCHEME, ASSETS_HOST } from '@shared/artifactUrl'
import { readFrontmatter } from '../workflow/frontmatter'
import { MERMAID_SCRIPTS } from './html'

// Raw HTML in the source is escaped (`html: false`); links are checked by markdown-it's validateLink.
const md = new MarkdownIt('default', { html: false })
const esc = md.utils.escapeHtml
const OUTLINED = new Set(['h2', 'h3'])
const OUTLINE_MIN = 3 // fewer headings than this is not worth an outline

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
}

// A heading's visible text: markdown syntax dropped, inline code kept.
function headingText(inline: Token): string {
  return (inline.children ?? []).filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('')
}

// Links to the h2/h3 sections, h3 nested under the h2 before it; '' when there are too few.
// Outside `<main>`, so the comment script never indexes or comments on it.
export function renderOutline(tokens: Token[]): string {
  const items: { level: number; id: string; text: string }[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    const id = tokens[i].type === 'heading_open' ? String(tokens[i].attrGet('id') ?? '') : ''
    if (id && OUTLINED.has(tokens[i].tag)) items.push({ level: tokens[i].tag === 'h2' ? 2 : 3, id, text: headingText(tokens[i + 1]) })
  }
  if (items.length < OUTLINE_MIN) return ''
  let html = ''
  let open = false // an h2's nested list is open
  let h2 = false // an h2 came before; leading h3s stay top level
  items.forEach((it, i) => {
    const link = `<a href="#${esc(it.id)}">${esc(it.text)}</a>`
    if (it.level === 3 && h2) {
      html += open ? '' : '<ul>'
      open = true
      html += `<li>${link}</li>`
      return
    }
    html += (open ? '</ul>' : '') + (i > 0 ? '</li>' : '') + `<li>${link}`
    open = false
    h2 ||= it.level === 2
  })
  html += (open ? '</ul>' : '') + '</li>'
  return `<nav class="toc" aria-label="Outline"><ul>${html}</ul></nav>`
}

// `- [ ] x` / `- [x] x` → a disabled checkbox; runs last, after text tokens are joined.
md.core.ruler.push('task_lists', (state) => {
  const t = state.tokens
  for (let i = 2; i < t.length; i++) {
    if (t[i].type !== 'inline' || t[i - 1].type !== 'paragraph_open' || t[i - 2].type !== 'list_item_open') continue
    const m = /^\[([ xX])\] /.exec(t[i].content)
    const first = t[i].children?.[0]
    if (!m || first?.type !== 'text') continue
    first.content = first.content.slice(4)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `
    t[i].children!.unshift(box)
    t[i - 2].attrJoin('class', 'task-list-item')
  }
})

// Source lines of every block (1-based, whole file) for the comment script: `data-line="<start>-<end>"`.
md.core.ruler.push('data_lines', (state) => {
  const offset = (state.env as { lineOffset?: number }).lineOffset ?? 0
  for (const t of state.tokens) {
    if (!t.map || !t.block || t.nesting === -1 || t.type === 'inline') continue
    t.attrSet('data-line', `${t.map[0] + 1 + offset}-${t.map[1] + offset}`)
  }
})

// h2/h3 get a unique slug id, the outline's link targets.
md.core.ruler.push('heading_ids', (state) => {
  const used = new Set<string>()
  const t = state.tokens
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i].type !== 'heading_open' || !OUTLINED.has(t[i].tag)) continue
    const base = slug(headingText(t[i + 1])) || 'section'
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    t[i].attrSet('id', id)
  }
})

// Mermaid reads the diagram from the element's text, so the escaped source is enough.
const fence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, opts, env, self) =>
  tokens[idx].info.trim() === 'mermaid'
    ? `<pre class="mermaid"${tokens[idx].attrGet('data-line') ? ` data-line="${tokens[idx].attrGet('data-line')}"` : ''}>${esc(tokens[idx].content)}</pre>\n`
    : fence(tokens, idx, opts, env, self)

function fmValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(fmValue).join(', ')
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Tokens of a file's body, and how many lines the frontmatter takes (none when it is broken and shown as text).
export function parseMarkdown(source: string): { tokens: Token[]; env: { lineOffset: number }; fm: ReturnType<typeof readFrontmatter> } {
  const fm = readFrontmatter(source)
  const body = fm.error ? source : fm.body
  const env = { lineOffset: fm.error ? 0 : source.split(/\r?\n/).length - body.split('\n').length }
  return { tokens: md.parse(body, env), env, fm }
}

// A full HTML document for the viewer: frontmatter table, then the body.
// Broken frontmatter is rendered as part of the text.
export function renderMarkdown(source: string, name: string): string {
  const { tokens, env, fm } = parseMarkdown(source)
  const entries = fm.error ? [] : Object.entries(fm.data)
  const table = entries.length === 0
    ? ''
    : '<table class="frontmatter"><tbody>'
      + entries.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(fmValue(v))}</td></tr>`).join('')
      + '</tbody></table>'
  const mermaid = tokens.some((t) => t.type === 'fence' && t.info.trim() === 'mermaid')
  const outline = renderOutline(tokens)
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<title>${esc(name)}</title>`
    + `<link rel="stylesheet" href="${ARTIFACT_SCHEME}://${ASSETS_HOST}/markdown.css">`
    + (mermaid ? MERMAID_SCRIPTS : '')
    + `<script src="${ARTIFACT_SCHEME}://${ASSETS_HOST}/comments.js" defer></script>`
    + (outline ? `<script src="${ARTIFACT_SCHEME}://${ASSETS_HOST}/outline.js" defer></script>` : '')
    + `</head><body><main class="markdown-body">${table}${md.renderer.render(tokens, md.options, env)}</main>${outline}</body></html>`
}
