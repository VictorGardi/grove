import type { DiffFile, DiffHunk } from '@shared/types'

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// `git diff` output (a/ b/ prefixes, no colour) → one DiffFile per `diff --git` section.
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0 // lines still to come in this hunk: a body line can look like a header (`--- x`)
  let newLeft = 0
  for (const line of text.split('\n')) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0]
      if (c === ' ' || c === '+' || c === '-') {
        const body = line.slice(1)
        if (c === ' ') {
          hunk.lines.push({ kind: 'context', text: body, old: oldNo++, new: newNo++ })
          oldLeft--
          newLeft--
        } else if (c === '+') {
          hunk.lines.push({ kind: 'add', text: body, old: null, new: newNo++ })
          newLeft--
          file!.additions++
        } else {
          hunk.lines.push({ kind: 'del', text: body, old: oldNo++, new: null })
          oldLeft--
          file!.deletions++
        }
        continue
      }
      if (c === '\\') continue // "\ No newline at end of file"
    }
    if (line.startsWith('diff --git ')) {
      const [a, b] = headerPaths(line.slice('diff --git '.length))
      file = { path: b ?? a ?? '', oldPath: a, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [], truncated: false, rendered: null }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (line.startsWith('\\')) continue
    const m = HUNK.exec(line)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[3])
      oldLeft = m[2] === undefined ? 1 : Number(m[2])
      newLeft = m[4] === undefined ? 1 : Number(m[4])
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk) {
      continue // trailing text after a hunk's counts ran out
    } else if (line.startsWith('new file mode')) file.status = 'added'
    else if (line.startsWith('deleted file mode')) file.status = 'deleted'
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = unquote(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed'
      file.path = unquote(line.slice('rename to '.length))
    } else if (line.startsWith('--- ')) {
      const p = sidePath(line.slice(4), 'a/')
      if (p !== null) file.oldPath = p
    } else if (line.startsWith('+++ ')) {
      const p = sidePath(line.slice(4), 'b/')
      if (p !== null) file.path = p
    } else if (line.startsWith('Binary files ') && line.endsWith(' differ')) file.binary = true
  }
  for (const f of files) if (f.status !== 'renamed') f.oldPath = null
  return files
}

// `--- a/x` / `+++ b/x`: null for /dev/null. Git adds a tab after names containing a space.
function sidePath(raw: string, prefix: string): string | null {
  const s = raw.replace(/\t$/, '')
  if (s === '/dev/null') return null
  const p = unquote(s)
  return p.startsWith(prefix) ? p.slice(prefix.length) : p
}

// `a/X b/Y` from the `diff --git` line. Unquoted with spaces is ambiguous; X === Y unless renamed,
// and renames carry `rename from/to`, so split it in half.
function headerPaths(rest: string): [string | null, string | null] {
  const strip = (p: string, prefix: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)
  if (rest.startsWith('"')) {
    const end = quotedEnd(rest)
    const a = unquote(rest.slice(0, end))
    const b = unquote(rest.slice(end + 1))
    return [strip(a, 'a/'), strip(b, 'b/')]
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "')
    return [strip(rest.slice(0, start), 'a/'), strip(unquote(rest.slice(start + 1)), 'b/')]
  }
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
    return [rest.slice(2, half), rest.slice(half + 3)]
  }
  const sp = rest.indexOf(' b/')
  return sp < 0 ? [null, null] : [strip(rest.slice(0, sp), 'a/'), rest.slice(sp + 3)]
}

function quotedEnd(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '"') return i + 1
  }
  return s.length
}

const ESC: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }

// Git's C-style quoting: "…" with backslash escapes and \ooo octal bytes, as UTF-8.
export function unquote(s: string): string {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const bytes: number[] = []
  const body = s.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const c = String.fromCodePoint(body.codePointAt(i)!)
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'))
      i += c.length - 1
      continue
    }
    const n = body[++i]
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8))
      i += 2
    } else bytes.push(ESC[n] ?? n.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}
