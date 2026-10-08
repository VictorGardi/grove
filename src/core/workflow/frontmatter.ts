import YAML from 'yaml'

export type Parsed = { data: Record<string, unknown>; body: string; error: string | null }

const isMapping = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// A leading `---` line up to the next `---` or `...` line, parsed with the YAML
// core schema so dates stay strings.
export function readFrontmatter(text: string): Parsed {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const lines = src.split(/\r?\n/)
  if (lines[0] !== '---') return { data: {}, body: text, error: null }
  const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'))
  if (end < 0) return { data: {}, body: '', error: 'unclosed frontmatter' }
  const body = lines.slice(end + 1).join('\n').replace(/\r/g, '')
  let data: unknown
  try {
    data = YAML.parse(lines.slice(1, end).join('\n'), { schema: 'core' })
  } catch (e) {
    return { data: {}, body, error: (e as Error).message }
  }
  if (data === null) return { data: {}, body, error: null }
  if (!isMapping(data)) return { data: {}, body, error: 'frontmatter is not a mapping' }
  return { data, body, error: null }
}
