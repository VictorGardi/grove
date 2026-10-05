import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chokidarWatchers, type Closer } from './watcher'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))

// Some sandboxes let fs.watch start, then fail it asynchronously (EMFILE).
async function canWatch(): Promise<boolean> {
  return new Promise((resolve) => {
    let w: fs.FSWatcher
    try {
      w = fs.watch(tmp())
    } catch {
      return resolve(false)
    }
    w.on('error', () => { w.close(); resolve(false) })
    setTimeout(() => { w.close(); resolve(true) }, 100)
  })
}

const until = async (check: () => boolean) => {
  for (let t = 0; t < 3000 && !check(); t += 50) await new Promise((r) => setTimeout(r, 50))
}
const settle = () => new Promise((r) => setTimeout(r, 800))

describe.skipIf(!(await canWatch()))('chokidarWatchers', () => {
  let closers: Closer[] = []
  afterEach(async () => {
    await Promise.all(closers.map((c) => c.close()))
    closers = []
  })

  async function watching(root: string) {
    const seen: string[] = []
    closers.push(chokidarWatchers.watchRoot(root, (slug) => seen.push(slug)))
    await settle() // let chokidar finish its initial scan
    return seen
  }

  it('reports folders as they are added, renamed and removed', async () => {
    const root = tmp()
    const seen = await watching(root)

    fs.mkdirSync(path.join(root, 'a'))
    fs.writeFileSync(path.join(root, 'a', 'feature.md'), '# A\n')
    await until(() => seen.includes('a'))
    expect(seen).toContain('a')

    seen.length = 0
    fs.renameSync(path.join(root, 'a'), path.join(root, 'b'))
    await until(() => seen.includes('a') && seen.includes('b'))
    expect(seen).toEqual(expect.arrayContaining(['a', 'b']))

    seen.length = 0
    fs.rmSync(path.join(root, 'b'), { recursive: true })
    await until(() => seen.includes('b'))
    expect(seen).toContain('b')
  })

  it('ignores *.tmp files and dot-folders', async () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, 'a'))
    const seen = await watching(root)
    fs.writeFileSync(path.join(root, 'a', 'x.tmp'), '')
    fs.mkdirSync(path.join(root, '.dot'))
    fs.writeFileSync(path.join(root, '.dot', 'feature.md'), '')
    await settle()
    expect(seen).toEqual([])
  })

  it('watchFile fires when a missing file is created', async () => {
    const file = path.join(tmp(), 'grove.config.json')
    let fired = 0
    closers.push(chokidarWatchers.watchFile(file, () => fired++))
    await settle()
    fs.writeFileSync(file, '{}')
    await until(() => fired > 0)
    expect(fired).toBeGreaterThan(0)
  })
})
