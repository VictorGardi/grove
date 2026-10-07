import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { ARTIFACT_SCHEME, ASSETS_HOST } from '@shared/artifactUrl'
import { readFrontmatter } from '../workflow/frontmatter'
import { MERMAID_SCRIPTS } from './html'

// Raw HTML in the source is escaped (`html: false`); links are checked by markdown-it's validateLink.
const md = new MarkdownIt('default', { html: false })
const esc = md.utils.escapeHtml

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
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<title>${esc(name)}</title>`
    + `<link rel="stylesheet" href="${ARTIFACT_SCHEME}://${ASSETS_HOST}/markdown.css">`
    + (mermaid ? MERMAID_SCRIPTS : '')
    + `<script src="${ARTIFACT_SCHEME}://${ASSETS_HOST}/comments.js" defer></script>`
    + `</head><body><main class="markdown-body">${table}${md.renderer.render(tokens, md.options, env)}</main></body></html>`
}
