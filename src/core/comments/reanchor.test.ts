import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminal, setupCore } from '../testing/setup'
import { gitRepo } from '../testing/gitRepo'

let s: ReturnType<typeof setupCore>
afterEach(() => s.disposeAll())

describe('core diff drafts', () => {
  it('follow their lines, then orphan when the lines change', async () => {
    s = setupCore()
    const repo = gitRepo(s.dir)
    repo.write('.gitignore', '*.json\nagents/\n')
    repo.write('a.txt', 'one\ntwo\n')
    repo.commit()
    repo.write('a.txt', 'one\nTWO\n')
    const core = s.make()
    await core.start()
    const session = await createTerminal(core)
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    const root = core.getSlices().diff!.root!
    const added = await core.commands.commentAdd({
      sessionId: session.id, body: 'why',
      anchor: { kind: 'diff', root, path: 'a.txt', side: 'new', start: 2, end: 2, lines: ['TWO'] },
    })
    expect(added.ok).toBe(true)

    repo.write('a.txt', 'x\ny\none\nTWO\n')
    await vi.waitFor(() => expect(core.getSlices().comments[0].anchor).toMatchObject({ start: 4, end: 4 }), { timeout: 8000 })
    expect(core.getSlices().comments[0].orphaned).toBe(false)

    repo.write('a.txt', 'x\ny\none\nother\n')
    await vi.waitFor(() => expect(core.getSlices().comments[0].orphaned).toBe(true), { timeout: 8000 })
    expect(core.getSlices().comments[0].anchor).toMatchObject({ start: 4, lines: ['TWO'] })
  }, 20000)
})

describe('core artifact drafts', () => {
  it('follow an edited file and orphan when the quote is gone', async () => {
    s = setupCore()
    const work = path.join(s.dir, 'docs', 'work')
    fs.mkdirSync(path.join(work, 'a'), { recursive: true })
    fs.writeFileSync(path.join(work, 'a', 'feature.md'), '---\nkind: feature\n---\n# a\n')
    const file = path.join(work, 'a', '03-design.md')
    fs.writeFileSync(file, 'intro\n\nthe quoted words\n')
    fs.utimesSync(file, new Date('2026-01-01'), new Date('2026-01-01'))
    const core = s.make()
    await core.start()
    const session = await createTerminal(core)
    const added = await core.commands.commentAdd({
      sessionId: session.id, body: 'hm',
      anchor: { kind: 'file', projectId: 'p', path: 'docs/work/a/03-design.md', exact: 'the quoted words', prefix: 'intro ', suffix: '', start: 3, end: 3 },
    })
    expect(added.ok).toBe(true)

    fs.writeFileSync(file, 'new\n\nnew too\n\nintro\n\nthe quoted words\n')
    fs.utimesSync(file, new Date('2026-02-01'), new Date('2026-02-01'))
    s.watchers.roots.get(work)!('a')
    await vi.waitFor(() => expect(core.getSlices().comments[0].anchor).toMatchObject({ start: 7, end: 7 }))
    expect(core.getSlices().comments[0].orphaned).toBe(false)

    fs.writeFileSync(file, 'new\n\nintro\n\nsomething else\n')
    fs.utimesSync(file, new Date('2026-03-01'), new Date('2026-03-01'))
    s.watchers.roots.get(work)!('a')
    await vi.waitFor(() => expect(core.getSlices().comments[0].orphaned).toBe(true))
  })
})
