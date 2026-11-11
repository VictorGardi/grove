// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown-render.ts'

const html = (src: string): string => renderMarkdown(src).innerHTML

describe('markdown preview', () => {
  it('draws headings of both kinds, paragraphs and the inline marks', () => {
    expect(html('# One\n\n## Two ##\n\nThree\n===')).toBe('<h1>One</h1><h2>Two</h2><h1>Three</h1>')
    expect(html('a *b* **c** ~~d~~ `e`')).toBe('<p>a <em>b</em> <strong>c</strong> <del>d</del> <code>e</code></p>')
    expect(html('one  \ntwo')).toBe('<p>one<br>two</p>')
    expect(html('1 &lt; 2 &amp; \\*3\\* &#65;')).toBe('<p>1 &lt; 2 &amp; *3* A</p>')
  })

  it('draws lists, nested lists and task items', () => {
    expect(html('- a\n- b\n  1. c\n  2. d')).toBe('<ul><li><p>a</p></li><li><p>b</p><ol><li><p>c</p></li><li><p>d</p></li></ol></li></ul>')
    expect(renderMarkdown('3. x\n4. y').querySelector('ol')?.getAttribute('start')).toBe('3')
    const tasks = renderMarkdown('- [x] done\n- [ ] todo')
    const boxes = [...tasks.querySelectorAll('input')]
    expect(boxes.map((box) => box.hasAttribute('checked'))).toEqual([true, false])
    expect(boxes.every((box) => box.getAttribute('type') === 'checkbox' && box.hasAttribute('disabled'))).toBe(true)
    expect(tasks.textContent).toBe('donetodo')
  })

  it('draws quotes, rules and code, keeping code exactly as written', () => {
    expect(html('> quoted\n> more\n\n---')).toBe('<blockquote><p>quoted\nmore</p></blockquote><hr>')
    expect(html('```js\nlet a = 1 < 2\n  b\n```')).toBe('<pre><code data-lang="js">let a = 1 &lt; 2\n  b</code></pre>')
    expect(html('    indented <b>\n    two')).toBe('<pre><code>indented &lt;b&gt;\ntwo</code></pre>')
  })

  it('draws tables with their alignment', () => {
    expect(html('| a | b |\n|---|:-:|\n| 1 | **2** |')).toBe(
      '<table><thead><tr><th>a</th><th style="text-align: center;">b</th></tr></thead><tbody><tr><td>1</td><td style="text-align: center;"><strong>2</strong></td></tr></tbody></table>',
    )
  })

  it('draws web links and bare addresses as links, and any other link as its text', () => {
    expect(html('[site](https://example.com "home") and https://auto.example and <mailto:a@b.co>')).toBe(
      '<p><a href="https://example.com" title="home" rel="noopener noreferrer">site</a> and <a href="https://auto.example" rel="noopener noreferrer">https://auto.example</a> and <a href="mailto:a@b.co" rel="noopener noreferrer">mailto:a@b.co</a></p>',
    )
    expect(html('[docs](./other.md) [bad](javascript:alert(1)) [data](data:text/html,x)')).toBe('<p>docs bad data</p>')
    expect(html('[ref][r] and [r]\n\n[r]: https://ref.example')).toBe(
      '<p><a href="https://ref.example" rel="noopener noreferrer">ref</a> and <a href="https://ref.example" rel="noopener noreferrer">r</a></p>',
    )
  })

  it('draws an image as its alt text, loading nothing', () => {
    const out = renderMarkdown('![logo *big*](https://example.com/a.png) ![rel](pics/b.png)')
    expect(out.innerHTML).toBe('<p><span class="md-image">logo big</span> <span class="md-image">rel</span></p>')
    expect(out.querySelector('img')).toBeNull()
  })

  it('shows raw HTML as text and never runs it', () => {
    const out = renderMarkdown('<script>alert(1)</script>\n\ntext <b onclick="x()">bold</b> <img src=x onerror=alert(1)>\n\n<div>\nblock\n</div>\n\n<!-- hidden -->')
    expect(out.querySelector('script, b, img, div')).toBeNull()
    expect(out.querySelector('[onclick], [onerror]')).toBeNull()
    expect(out.textContent).toContain('<script>alert(1)</script>')
    expect(out.textContent).toContain('<b onclick="x()">bold</b>')
    expect(out.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(out.textContent).not.toContain('hidden')
  })

  it('renders nothing for empty text, and survives an unclosed fence or a lone marker', () => {
    expect(html('')).toBe('')
    expect(html('```\nopen')).toBe('<pre><code>open</code></pre>')
    expect(() => renderMarkdown('- \n>\n|\n#')).not.toThrow()
  })
})
