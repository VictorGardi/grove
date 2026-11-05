import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Every colour and every size lives in a token. Tokens are defined in src/tokens.css only; everything else
// refers to them with var(--...). This scan fails on a literal colour or a literal length.
const UI = fileURLToPath(new URL('.', import.meta.url))
const SKIPPED_DIRS = new Set(['src-tauri', 'dist', 'node_modules', 'demo'])
const SKIPPED_FILES = new Set(['src/tokens.css'])

// `#` followed by 3, 4, 6 or 8 hex digits, not followed by a name character (so `#add-space` is not a colour).
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/g
// Colour functions.
const COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g
// A number with a length or time unit. Bare `0` has no unit and is not matched.
const LENGTH = /(?<![\w.])(\d+(?:\.\d+)?|\.\d+)(px|rem|em|pt|vh|vw|ms|s)(?!\w)/g
const ALLOWED_LENGTHS = new Set(['1px', '0s', '0ms'])

function sourceFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...sourceFiles(`${dir}/${entry.name}`, `${rel}/`))
      continue
    }
    if (!/\.(css|ts|tsx)$/.test(entry.name)) continue
    if (entry.name.endsWith('.test.ts')) continue
    if (SKIPPED_FILES.has(rel)) continue
    out.push(rel)
  }
  return out
}

function literalViolations(files: Array<{ name: string; text: string }>): string[] {
  const found: string[] = []
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      const where = `${file.name}:${index + 1}`
      for (const match of line.matchAll(HEX)) found.push(`${where} colour ${match[0]}`)
      for (const match of line.matchAll(COLOUR_FN)) found.push(`${where} colour ${match[0]}`)
      for (const match of line.matchAll(LENGTH)) {
        if (!ALLOWED_LENGTHS.has(match[0])) found.push(`${where} length ${match[0]}`)
      }
    })
  }
  return found
}

describe('literal values', () => {
  it('detects colours and lengths written outside tokens', () => {
    const found = literalViolations([
      {
        name: 'a.css',
        text: [
          'color: #fff;',
          'color: var(--x); padding: #add-space;',
          'background: rgba(0, 0, 0, .5);',
          'width: 12px; height: 1.5rem; margin: 0; top: 100%; border: 1px solid; ',
          'transition: 2s; delay: 0.2s; fast: 90ms; ok: 0s 0ms;',
          'box-shadow: 0 0 0 3px color-mix(in srgb, var(--a) 15%, transparent);',
        ].join('\n'),
      },
    ])
    expect(found).toEqual([
      'a.css:1 colour #fff',
      'a.css:3 colour rgba(',
      'a.css:4 length 12px',
      'a.css:4 length 1.5rem',
      'a.css:5 length 2s',
      'a.css:5 length 0.2s',
      'a.css:5 length 90ms',
      'a.css:6 length 3px',
    ])
  })

  it('finds no literal in the ui sources, outside the tokens file', () => {
    const files = sourceFiles(UI).map((name) => ({ name, text: readFileSync(`${UI}${name}`, 'utf8') }))
    expect(files.length).toBeGreaterThan(0)
    expect(literalViolations(files)).toEqual([])
  })

  it('keeps inline styles out of index.html', () => {
    const html = readFileSync(`${UI}index.html`, 'utf8')
    expect(html).not.toMatch(/\sstyle=/)
    expect(html).not.toMatch(/<style[\s>]/)
  })
})
