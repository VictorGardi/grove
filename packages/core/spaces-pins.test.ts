import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../protocol/messages.ts'
import { RpcError } from '../protocol/errors.ts'
import type { GitRun } from './gitrun.ts'
import { GitError } from './gitrun.ts'
import { SpacesService } from './spaces.ts'

// Pins are saved on the space's own record, so every case goes through the service and its state file, as a restart would.
describe('pinned spaces', () => {
  let root: string
  let file: string
  let folders: string[]

  // No folder here is a repository, so the service never needs a real git.
  const notRepo: GitRun = async () => {
    throw new GitError('not a git repository', true)
  }
  const open = (): SpacesService => new SpacesService(file, path.join(root, 'worktrees'), notRepo)
  const pinnedIds = async (service: SpacesService): Promise<string[]> =>
    (await service.allInfo())
      .filter((info) => info.pinnedAt !== null)
      .sort((a, b) => a.pinnedAt! - b.pinnedAt!)
      .map((info) => info.id)

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-pins-')))
    file = path.join(root, 'state.json')
    folders = ['a', 'b', 'c'].map((name) => {
      const folder = path.join(root, name)
      fs.mkdirSync(folder)
      return folder
    })
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('starts unpinned, and a pin is shown with the time it was made', async () => {
    const service = open()
    const space = await service.add(folders[0])
    expect(space.pinnedAt).toBeNull()
    const before = Date.now()
    service.setPinned(space.id, true)
    const pinned = (await service.spaceInfo(space.id))!
    expect(pinned.pinnedAt).toBeGreaterThanOrEqual(before)
    expect(pinned.pinnedAt).toBeLessThanOrEqual(Date.now())
  })

  it('is still there after the state is loaded again, in the same order', async () => {
    const service = open()
    const [a, b, c] = [await service.add(folders[0]), await service.add(folders[1]), await service.add(folders[2])]
    service.setPinned(c.id, true)
    service.setPinned(a.id, true)
    expect(await pinnedIds(open())).toEqual([c.id, a.id])
    expect(await pinnedIds(open())).not.toContain(b.id)
  })

  it('puts a space pinned again after an unpin at the bottom', async () => {
    const service = open()
    const [a, b] = [await service.add(folders[0]), await service.add(folders[1])]
    service.setPinned(a.id, true)
    service.setPinned(b.id, true)
    service.setPinned(a.id, false)
    expect(await pinnedIds(service)).toEqual([b.id])
    service.setPinned(a.id, true)
    expect(await pinnedIds(open())).toEqual([b.id, a.id])
  })

  it('keeps the first pin time when a pinned space is pinned again', async () => {
    const service = open()
    const space = await service.add(folders[0])
    service.setPinned(space.id, true, 1_000)
    service.setPinned(space.id, true, 9_000)
    expect((await service.spaceInfo(space.id))!.pinnedAt).toBe(1_000)
  })

  it('orders pins made in the same millisecond by the order they were made', async () => {
    const service = open()
    const [a, b] = [await service.add(folders[0]), await service.add(folders[1])]
    service.setPinned(b.id, true, 5_000)
    service.setPinned(a.id, true, 5_000)
    expect(await pinnedIds(open())).toEqual([b.id, a.id])
  })

  it('ends the pin with the space: closed and added again, the folder is not pinned', async () => {
    const service = open()
    const space = await service.add(folders[0])
    service.setPinned(space.id, true)
    service.removeSpace(space.id)
    const again = await service.add(folders[0])
    expect(again.pinnedAt).toBeNull()
    expect(await pinnedIds(open())).toEqual([])
  })

  it('pins two spaces on one folder separately', async () => {
    const service = open()
    const first = await service.add(folders[0])
    const second = await service.add(folders[0])
    service.setPinned(second.id, true)
    expect(await pinnedIds(open())).toEqual([second.id])
    expect((await open().spaceInfo(first.id))!.pinnedAt).toBeNull()
  })

  it('loads a record saved without a pin as unpinned', async () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, spaces: [{ id: 'sp_old', path: folders[0] }], tabs: [] }))
    const service = open()
    expect((await service.spaceInfo('sp_old'))!.pinnedAt).toBeNull()
    service.setPinned('sp_old', true)
    expect(await pinnedIds(open())).toEqual(['sp_old'])
  })

  it('unpinning clears it, and unpinning an unpinned space changes nothing', async () => {
    const service = open()
    const space = await service.add(folders[0])
    service.setPinned(space.id, true)
    service.setPinned(space.id, false)
    service.setPinned(space.id, false)
    expect(await pinnedIds(open())).toEqual([])
  })

  it('refuses a space that is not there', () => {
    const error = (() => {
      try {
        open().setPinned('nope', true)
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(RpcError)
    expect((error as RpcError).code).toBe(ERROR_CODES.invalidParams)
  })

  it('fails the pin while the state file is refused, and leaves the file as it was', () => {
    const refused = JSON.stringify({ version: 2, spaces: [{ id: 'sp_x', path: folders[0] }], tabs: [] })
    fs.writeFileSync(file, refused)
    const service = open()
    expect(() => service.setPinned('sp_x', true)).toThrow('version 2')
    expect(fs.readFileSync(file, 'utf8')).toBe(refused)
  })
})
