import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Index just past the string literal that starts at `i` (source[i] is its quote).
function skipString(source: string, i: number): number {
  const quote = source[i]
  for (let j = i + 1; j < source.length; j++) {
    const c = source[j]
    if (c === '\\') j++
    else if (c === quote) return j + 1
    else if (quote === '`' && c === '$' && source[j + 1] === '{') j = skipBlock(source, j + 1) - 1
  }
  return source.length
}

// Index just past the `}` matching the `{` at `i`.
function skipBlock(source: string, i: number): number {
  let depth = 0
  for (let j = i; j < source.length; j++) {
    const c = source[j]
    if (c === "'" || c === '"' || c === '`') j = skipString(source, j) - 1
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return j + 1
  }
  return source.length
}

// Keys at the top level of the object literal text between its braces.
function topLevelKeys(body: string): string[] {
  const keys: string[] = []
  let depth = 0
  let expectKey = true
  for (let j = 0; j < body.length; j++) {
    const c = body[j]
    if (depth === 0 && expectKey && !/\s/.test(c)) {
      const m = /^(?:(['"`])(.*?)\1|([\w$-]+))\s*:/.exec(body.slice(j))
      if (m) keys.push(m[2] ?? m[3])
      expectKey = false
    }
    if (c === "'" || c === '"' || c === '`') j = skipString(body, j) - 1
    else if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) expectKey = true
  }
  return keys
}

// Visual inline styles are not allowed; an object literal of CSS variables is.
export function inlineStyleViolations(source: string): string[] {
  const violations: string[] = []
  for (const m of source.matchAll(/style=/g)) {
    const at = m.index
    const open = at + 'style='.length
    let ok = false
    if (source.startsWith('{{', open)) {
      const end = skipBlock(source, open + 1)
      const keys = topLevelKeys(source.slice(open + 2, end - 1))
      ok = keys.length > 0 && keys.every((k) => k.startsWith('--'))
    }
    if (!ok) {
      const line = source.slice(0, at).split('\n').length
      violations.push(`line ${line}: ${source.split('\n')[line - 1].trim()}`)
    }
  }
  return violations
}

describe('inlineStyleViolations', () => {
  it('allows an object of CSS variables', () => {
    expect(inlineStyleViolations("<div style={{ '--w': `${n}px` } as CSSProperties} />")).toEqual([])
  })
  it('rejects a visual property', () => {
    expect(inlineStyleViolations("<div style={{ color: 'red' }} />")).toHaveLength(1)
  })
  it('rejects a visual property next to a variable', () => {
    expect(inlineStyleViolations("<div style={{ '--a': 1, padding: 4 }} />")).toHaveLength(1)
  })
  it('rejects a style object passed by reference', () => {
    expect(inlineStyleViolations('<div style={obj} />')).toHaveLength(1)
  })
  it('passes a file without styles', () => {
    expect(inlineStyleViolations('<div className={s.x} />')).toEqual([])
  })
})

describe('src/renderer', () => {
  it('has no visual inline styles', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const found = Object.fromEntries(
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => [f, inlineStyleViolations(readFileSync(join(root, f), 'utf8'))])
        .filter(([, v]) => v.length > 0),
    )
    expect(found).toEqual({})
  })
})
