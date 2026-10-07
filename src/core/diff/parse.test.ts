import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, unquote, untrackedFile } from './parse'

const lines = (...l: string[]) => l.join('\n') + '\n'

describe('parseUnifiedDiff', () => {
  it('parses a modified file with two hunks and numbers every line', () => {
    const [f, ...rest] = parseUnifiedDiff(lines(
      'diff --git a/src/x.ts b/src/x.ts',
      'index 1111111..2222222 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,3 +1,3 @@ fn',
      ' a',
      '-b',
      '+B',
      ' c',
      '@@ -10,2 +10,3 @@',
      ' j',
      '+k2',
      ' l',
    ))
    expect(rest).toEqual([])
    expect(f).toMatchObject({ path: 'src/x.ts', oldPath: null, status: 'modified', binary: false, additions: 2, deletions: 1, truncated: false, rendered: null })
    expect(f.hunks.map((h) => [h.header, h.oldStart, h.newStart])).toEqual([['@@ -1,3 +1,3 @@ fn', 1, 1], ['@@ -10,2 +10,3 @@', 10, 10]])
    expect(f.hunks[0].lines).toEqual([
      { kind: 'context', text: 'a', old: 1, new: 1 },
      { kind: 'del', text: 'b', old: 2, new: null },
      { kind: 'add', text: 'B', old: null, new: 2 },
      { kind: 'context', text: 'c', old: 3, new: 3 },
    ])
    expect(f.hunks[1].lines).toEqual([
      { kind: 'context', text: 'j', old: 10, new: 10 },
      { kind: 'add', text: 'k2', old: null, new: 11 },
      { kind: 'context', text: 'l', old: 11, new: 12 },
    ])
  })

  it('parses added and deleted files', () => {
    const files = parseUnifiedDiff(lines(
      'diff --git a/new.md b/new.md',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/new.md',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      'diff --git a/old.md b/old.md',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/old.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ))
    expect(files.map((f) => [f.path, f.oldPath, f.status, f.additions, f.deletions])).toEqual([
      ['new.md', null, 'added', 2, 0],
      ['old.md', null, 'deleted', 0, 1],
    ])
    expect(files[0].hunks[0].lines.map((l) => l.new)).toEqual([1, 2])
    expect(files[1].hunks[0].lines).toEqual([{ kind: 'del', text: 'gone', old: 1, new: null }])
  })

  it('skips the no-newline marker', () => {
    const [f] = parseUnifiedDiff(lines(
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1 +1 @@',
      '-x',
      '\\ No newline at end of file',
      '+y',
      '\\ No newline at end of file',
    ))
    expect(f.hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'add'])
  })

  it('reads a body line that looks like a file header as content', () => {
    const [f] = parseUnifiedDiff(lines(
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1,2 +1,2 @@',
      '--- a/b',
      '+++ b/c',
      ' x',
    ))
    expect(f.path).toBe('a')
    expect(f.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([['del', '-- a/b'], ['add', '++ b/c'], ['context', 'x']])
  })

  it('marks binary files and gives them no hunks', () => {
    const [f] = parseUnifiedDiff(lines(
      'diff --git a/img.png b/img.png',
      'new file mode 100644',
      'index 0000000..1111111',
      'Binary files /dev/null and b/img.png differ',
    ))
    expect(f).toMatchObject({ path: 'img.png', status: 'added', binary: true, hunks: [] })
  })

  it('reads a mode-only change as modified without hunks', () => {
    const [f] = parseUnifiedDiff(lines('diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755'))
    expect(f).toMatchObject({ path: 'run.sh', status: 'modified', hunks: [] })
  })

  it('unquotes paths with a space and a non-ASCII char', () => {
    const [plain, quoted] = parseUnifiedDiff(lines(
      'diff --git a/a b.md b/a b.md',
      '--- a/a b.md\t',
      '+++ b/a b.md\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git "a/\\303\\251 x\\tq.md" "b/\\303\\251 x\\tq.md"',
      '--- "a/\\303\\251 x\\tq.md"',
      '+++ "b/\\303\\251 x\\tq.md"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ))
    expect(plain.path).toBe('a b.md')
    expect(quoted.path).toBe('é x\tq.md')
  })

  it('parses a pure rename, a rename with edits and a binary rename', () => {
    const files = parseUnifiedDiff(lines(
      'diff --git a/old.md b/new.md',
      'similarity index 100%',
      'rename from old.md',
      'rename to new.md',
      'diff --git a/src/a.ts b/lib/a.ts',
      'similarity index 80%',
      'rename from src/a.ts',
      'rename to lib/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/lib/a.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-x',
      '+y',
      'diff --git a/i.png b/img/i.png',
      'similarity index 90%',
      'rename from i.png',
      'rename to img/i.png',
      'index 1111111..2222222 100644',
      'Binary files a/i.png and b/img/i.png differ',
    ))
    expect(files.map((f) => [f.oldPath, f.path, f.status, f.binary, f.hunks.length, f.additions, f.deletions])).toEqual([
      ['old.md', 'new.md', 'renamed', false, 0, 0, 0],
      ['src/a.ts', 'lib/a.ts', 'renamed', false, 1, 1, 1],
      ['i.png', 'img/i.png', 'renamed', true, 0, 0, 0],
    ])
  })

  it('cuts a section over the byte cap but keeps its counts', () => {
    const [big, small] = parseUnifiedDiff(lines(
      'diff --git a/big b/big', '--- a/big', '+++ b/big', '@@ -1 +1 @@', '-' + 'x'.repeat(100), '+' + 'y'.repeat(100),
      'diff --git a/s b/s', '--- a/s', '+++ b/s', '@@ -1 +1 @@', '-a', '+b',
    ), 150)
    expect(big).toMatchObject({ truncated: true, hunks: [], additions: 1, deletions: 1 })
    expect(small).toMatchObject({ truncated: false })
    expect(small.hunks).toHaveLength(1)
  })

  it('takes the path from the header when there are no ---/+++ lines', () => {
    const [f] = parseUnifiedDiff(lines('diff --git "a/\\303\\251.sh" "b/\\303\\251.sh"', 'old mode 100644', 'new mode 100755'))
    expect(f.path).toBe('é.sh')
  })
})

describe('unquote', () => {
  it('decodes escapes and octal UTF-8 bytes, leaving unquoted text alone', () => {
    expect(unquote('"a\\"b\\\\c\\n"')).toBe('a"b\\c\n')
    expect(unquote('"\\360\\237\\214\\263"')).toBe('🌳')
    expect(unquote('"🌳 x"')).toBe('🌳 x')
    expect(unquote('plain')).toBe('plain')
  })
})

describe('untrackedFile', () => {
  it('numbers every line, with or without a final newline, and gives an empty file no hunk', () => {
    expect(untrackedFile('a', 'x\ny', false).hunks[0].lines.map((l) => [l.text, l.new])).toEqual([['x', 1], ['y', 2]])
    expect(untrackedFile('a', 'x\n', false).additions).toBe(1)
    expect(untrackedFile('a', '', false).hunks).toEqual([])
    expect(untrackedFile('a', null, true)).toMatchObject({ status: 'untracked', truncated: true, hunks: [], additions: 0 })
  })
})
