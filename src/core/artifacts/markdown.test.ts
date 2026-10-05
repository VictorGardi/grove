import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MERMAID_SCRIPTS } from './html'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders frontmatter as a table, not as text', () => {
    const out = renderMarkdown('---\nstatus: approved\nbased_on:\n  - a@1\n  - b@2\n---\n# Title\n', '03-design.md')
    expect(out).toContain('<table class="frontmatter">')
    expect(out).toContain('<th>status</th><td>approved</td>')
    expect(out).toContain('<th>based_on</th><td>a@1, b@2</td>')
    expect(out).toContain('<h1>Title</h1>')
    expect(out).not.toContain('status: approved')
  })

  it('renders task list items as disabled checkboxes', () => {
    const out = renderMarkdown('- [x] done\n- [ ] open\n', 'plan.md')
    expect(out).toContain('<input type="checkbox" disabled checked> done')
    expect(out).toContain('<input type="checkbox" disabled> open')
    expect(out).toContain('class="task-list-item"')
    expect(out).not.toContain('[x]')
    expect(out).not.toContain('[ ]')
  })

  it('renders a mermaid fence as <pre class="mermaid"> with the bundled scripts', () => {
    const out = renderMarkdown('```mermaid\nflowchart LR\n  A-->B\n```\n', 'r.md')
    expect(out).toContain('<pre class="mermaid">flowchart LR\n  A--&gt;B\n</pre>')
    expect(out).toContain(MERMAID_SCRIPTS)
    expect(renderMarkdown('# no diagram\n', 'r.md')).not.toContain('mermaid.min.js')
  })

  it('escapes raw HTML in the source', () => {
    const out = renderMarkdown('<script>alert(1)</script>\n', 'x.md')
    expect(out).not.toContain('<script>alert')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes frontmatter values', () => {
    expect(renderMarkdown('---\ntitle: "<b>x</b>"\n---\n', 'x.md')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('renders a file without frontmatter', () => {
    const src = fs.readFileSync(path.resolve('docs/work/2026-10-05-04-artifact-viewer/00-ticket.md'), 'utf8')
    const out = renderMarkdown(src, '00-ticket.md')
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<title>00-ticket.md</title>')
    expect(out).toContain('<link rel="stylesheet" href="grove-artifact://assets/markdown.css">')
    expect(out).toContain('<h3>')
    expect(out).not.toContain('class="frontmatter"')
  })

  it('renders the whole source when the frontmatter is broken', () => {
    const out = renderMarkdown('---\na: [\n---\nbody\n', 'x.md')
    expect(out).toContain('body')
    expect(out).not.toContain('class="frontmatter"')
  })
})
