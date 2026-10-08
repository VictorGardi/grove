import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { slugFor } from './autolink'

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-link-'))
  const root = path.join(dir, 'docs', 'work')
  for (const slug of ['a', 'epic']) fs.mkdirSync(path.join(root, slug), { recursive: true })
  return { dir, root }
}

describe('slugFor', () => {
  it('matches relative and absolute paths, and folders not created yet', () => {
    const { dir, root } = project()
    expect(slugFor(['docs/work/a/x.md'], dir, root)).toBe('a')
    expect(slugFor([path.join(dir, 'docs/work/a/x.md')], dir, root)).toBe('a')
    expect(slugFor(['docs/work/new/01-questions.md'], dir, root)).toBe('new')
    expect(slugFor(['docs/work/epic/03-design.md'], dir, root)).toBe('epic')
  })

  it('matches through symlinks (realpath on both sides)', () => {
    const { dir, root } = project()
    const real = fs.realpathSync(dir)
    expect(slugFor([path.join(real, 'docs/work/a/x.md')], dir, root)).toBe('a')
    expect(slugFor(['docs/work/a/x.md'], dir, path.join(real, 'docs', 'work'))).toBe('a')
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-ln-')), 'proj')
    fs.symlinkSync(real, link)
    expect(slugFor([path.join(link, 'docs/work/a/x.md')], dir, root)).toBe('a')
  })

  it('ignores paths outside the root, files directly in it, and dot folders', () => {
    const { dir, root } = project()
    expect(slugFor(['src/x.ts'], dir, root)).toBe(null)
    expect(slugFor(['/elsewhere/x'], dir, root)).toBe(null)
    expect(slugFor(['docs/work/README.md'], dir, root)).toBe(null)
    expect(slugFor(['docs/work/.git/x'], dir, root)).toBe(null)
    expect(slugFor(['docs/work/a/x.md'], dir, null)).toBe(null)
  })

  it('takes the last matching path', () => {
    const { dir, root } = project()
    expect(slugFor(['docs/work/a/x', 'docs/work/b/y', 'src/z'], dir, root)).toBe('b')
  })
})
