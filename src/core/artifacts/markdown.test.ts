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
    expect(out).toContain('>Title</h1>')
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
    expect(out).toContain('<pre class="mermaid" data-line="1-4">flowchart LR\n  A--&gt;B\n</pre>')
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
    expect(out).toContain('<h3 ')
    expect(out).not.toContain('class="frontmatter"')
  })

  it('renders the whole source when the frontmatter is broken', () => {
    const out = renderMarkdown('---\na: [\n---\nbody\n', 'x.md')
    expect(out).toContain('body')
    expect(out).not.toContain('class="frontmatter"')
  })

  it('blocks carry data-line offset by frontmatter', () => {
    const out = renderMarkdown('---\nstatus: x\n---\n# Title\n\npara one\nstill one\n\n```ts\ncode\n```\n', 'a.md')
    expect(out).toContain('<h1 data-line="4-4">Title</h1>')
    expect(out).toContain('<p data-line="6-7">para one')
    expect(out).toContain('<code data-line="9-11" class="language-ts">')
    expect(out).toContain('<script src="grove-artifact://assets/comments.js" defer></script>')
  })

  it('numbers lines from 1 without frontmatter', () => {
    expect(renderMarkdown('# T\n', 'a.md')).toContain('<h1 data-line="1-1">')
  })
})

describe('outline', () => {
  const doc = '# Title\n\n## Scope & goals\n\ntext\n\n### Open `questions`?\n\n### Open questions\n\n## Scope & goals\n\n## Next\n'

  it('gives h2 and h3 unique slug ids, keeping data-line', () => {
    const out = renderMarkdown(doc, 'a.md')
    expect(out).toContain('<h1 data-line="1-1">Title</h1>')
    expect(out).toContain('<h2 data-line="3-3" id="scope-goals">Scope &amp; goals</h2>')
    expect(out).toContain('<h3 data-line="7-7" id="open-questions">')
    expect(out).toContain('<h3 data-line="9-9" id="open-questions-2">')
    expect(out).toContain('<h2 data-line="11-11" id="scope-goals-2">')
    expect(out).toContain('<p data-line="5-5">text</p>')
  })

  it('nests h3 under the h2 before it and leaves out h1', () => {
    expect(renderMarkdown(doc, 'a.md')).toContain('<nav class="toc" aria-label="Outline"><ul>'
      + '<li><a href="#scope-goals">Scope &amp; goals</a><ul>'
      + '<li><a href="#open-questions">Open questions?</a></li>'
      + '<li><a href="#open-questions-2">Open questions</a></li></ul></li>'
      + '<li><a href="#scope-goals-2">Scope &amp; goals</a></li>'
      + '<li><a href="#next">Next</a></li></ul></nav>')
  })

  it('keeps leading h3s top level', () => {
    expect(renderMarkdown('### a\n\n### b\n\n## c\n', 'a.md'))
      .toContain('<ul><li><a href="#a">a</a></li><li><a href="#b">b</a></li><li><a href="#c">c</a></li></ul>')
  })

  it('sits outside <main class="markdown-body">, with its script', () => {
    const out = renderMarkdown(doc, 'a.md')
    expect(out).toMatch(/<\/main><nav class="toc"[^]*<\/nav><\/body>/)
    expect(out.slice(out.indexOf('<main'), out.indexOf('</main>'))).not.toContain('class="toc"')
    expect(out).toContain('<script src="grove-artifact://assets/outline.js" defer></script>')
  })

  it('is left out with fewer than 3 h2/h3 headings', () => {
    const out = renderMarkdown('# T\n\n## a\n\n### b\n\n#### c\n', 'a.md')
    expect(out).not.toContain('<nav')
    expect(out).not.toContain('outline.js')
    expect(out).toContain('<h2 data-line="3-3" id="a">')
  })
})
