import { describe, expect, it } from 'vitest'
import type { ArtifactTarget, FileTarget } from './types'
import { artifactUrl, isViewable, parseArtifactUrl } from './artifactUrl'

describe('artifactUrl', () => {
  it('encodes path segments and appends the hash', () => {
    const t: ArtifactTarget = { kind: 'artifact', projectId: 'p1', slug: 'my-feat', path: 'refs/a b.html', hash: 'q1-x', fromDiff: null }
    expect(artifactUrl(t)).toBe('grove-artifact://p1/my-feat/refs/a%20b.html#q1-x')
    expect(artifactUrl({ ...t, hash: null })).toBe('grove-artifact://p1/my-feat/refs/a%20b.html')
  })

  it('round-trips through parseArtifactUrl', () => {
    for (const path of ['03-design.html', 'a b/c d.html', 'x#y.html']) {
      for (const hash of [null, 'sec-2']) {
        const t: ArtifactTarget = { kind: 'artifact', projectId: 'p1', slug: 's', path, hash, fromDiff: null }
        expect(parseArtifactUrl(artifactUrl(t))).toEqual(t)
      }
    }
  })

  it('round-trips project files through the ~file segment', () => {
    for (const path of ['CONTEXT.md', 'docs/adr/0021 x.md', 'a/b/c.html']) {
      for (const hash of [null, 'h']) {
        const t: FileTarget = { kind: 'file', projectId: 'p1', path, hash, fromDiff: null }
        expect(parseArtifactUrl(artifactUrl(t))).toEqual(t)
      }
    }
    expect(artifactUrl({ kind: 'file', projectId: 'p1', path: 'docs/adr/a b.md', hash: 'x', fromDiff: null }))
      .toBe('grove-artifact://p1/~file/docs/adr/a%20b.md#x')
  })

  it('rejects assets, other schemes, missing paths and garbage', () => {
    for (const url of [
      'grove-artifact://assets/mermaid.min.js',
      'https://p1/s/x.html',
      'grove-artifact://p1/s',
      'grove-artifact://p1/s/',
      'grove-artifact://p1/~file/',
      'not a url',
    ]) expect(parseArtifactUrl(url)).toBeNull()
  })
})

describe('isViewable', () => {
  it.each(['03-design.html', 'x.HTM', 'feature.md', 'refs/a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg'])('accepts %s', (name) => {
    expect(isViewable(name)).toBe(true)
  })

  it.each(['notes.txt', 'Makefile', 'a.md.bak', 'dir.d/x'])('rejects %s', (name) => {
    expect(isViewable(name)).toBe(false)
  })
})
