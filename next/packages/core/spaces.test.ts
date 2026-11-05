import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RpcClient } from '../protocol/client.ts'
import { connectRpc } from '../protocol/client.ts'
import { b64ToBytes, bytesToB64 } from '../protocol/framing.ts'
import { coreSocketPath, holderSocketPath } from '../protocol/paths.ts'
import { ERROR_CODES, METHODS } from '../protocol/messages.ts'
import { RpcError } from '../protocol/errors.ts'
import { SpacesService } from './spaces.ts'
import { startStack, stopHolder, waitFor } from './test-helpers.ts'

const screenText = async (client: RpcClient, id: string): Promise<string> => {
  const { screenB64 } = await client.request(METHODS.tabsAttach, { id })
  return b64ToBytes(screenB64).toString('utf8')
}

// Types a command that prints the shell's physical working directory tagged with a per-call nonce,
// then waits for that exact output (so an earlier call's output cannot satisfy the wait).
const shellDirectory = async (client: RpcClient, id: string): Promise<string> => {
  const nonce = crypto.randomUUID().slice(0, 8)
  await client.request(METHODS.tabsWrite, {
    id,
    dataB64: bytesToB64(Buffer.from(`echo "at:$(pwd -P)#${nonce}"\n`)),
  })
  const pattern = new RegExp(`at:(/[^\\s#]+)#${nonce}`)
  const screen = await waitFor(
    () => screenText(client, id),
    (text) => pattern.test(text),
  )
  const match = pattern.exec(screen)
  return match?.[1] ?? ''
}

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], {
    cwd,
    stdio: 'pipe',
  })

// The core stops asynchronously after the holder is told to stop; wait until its socket refuses connections.
async function waitForCoreGone(): Promise<void> {
  await waitFor(
    async () =>
      connectRpc(coreSocketPath()).then(
        (client) => {
          client.close()
          return true
        },
        () => false,
      ),
    (up) => !up,
  )
}

describe('spaces and tabs', () => {
  let home: string
  let root: string
  let holder: ChildProcess | undefined
  let clients: RpcClient[] = []
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-spaces-')))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    for (const client of clients) client.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  })

  // A main repo and one linked worktree of it, both real folders.
  function makeRepo(): { main: string; worktree: string } {
    const main = path.join(root, 'widgets')
    const worktree = path.join(root, 'widgets-feature')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    git(main, ['worktree', 'add', '-q', '-b', 'feature', worktree])
    return { main, worktree }
  }

  it('opens a tab whose shell starts in the space root', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.mkdtempSync(path.join(root, 'plain-'))
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: space })

    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })
    expect(await shellDirectory(core, id)).toBe(fs.realpathSync(space))
  })

  it('rejects a relative space path with invalidParams', async () => {
    // The RPC client surfaces only the message, so the code is checked on the service that throws it.
    const service = new SpacesService(path.join(home, 'state.json'))
    const error = await service.add('relative/dir').then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(RpcError)
    expect((error as RpcError).code).toBe(ERROR_CODES.invalidParams)
    expect((error as Error).message).toBe('path must be absolute: relative/dir')
  })

  it('lists a worktree under its main repo space, and top-level when the main repo is not a space', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const { main, worktree } = makeRepo()

    const mainSpace = await core.request(METHODS.spacesAdd, { path: main })
    const worktreeSpace = await core.request(METHODS.spacesAdd, { path: worktree })
    const both = await core.request(METHODS.spacesList, {})
    expect(both.spaces).toContainEqual({
      id: worktreeSpace.id,
      path: worktree,
      name: 'widgets-feature',
      repoName: 'widgets',
      parent: mainSpace.id,
      branch: 'feature',
    })
    expect(both.spaces).toContainEqual({ id: mainSpace.id, path: main, name: 'widgets', repoName: 'widgets', parent: null, branch: 'main' })
    expect(both.refused).toBeNull()

    // Only the worktree is a space now (a fresh stack reads the same file).
    await stopHolder(holder)
    holder = undefined
    await waitForCoreGone()
    fs.rmSync(path.join(home, 'state.json'))
    const again = await startStack()
    holder = again.holder
    clients.push(again.core)
    const readded = await again.core.request(METHODS.spacesAdd, { path: worktree })
    const alone = await again.core.request(METHODS.spacesList, {})
    expect(alone.spaces).toEqual([
      { id: readded.id, path: worktree, name: 'widgets-feature', repoName: 'widgets', parent: null, branch: 'feature' },
    ])
  })

  it('restores the same space and tab id, with a live shell in the space root, after a full restart', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const { worktree } = makeRepo()
    const { id: spaceId } = await core.request(METHODS.spacesAdd, { path: worktree })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId, cols: 80, rows: 24 })
    expect(await shellDirectory(core, id)).toBe(worktree)

    core.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    await waitForCoreGone()

    const next = await startStack()
    holder = next.holder
    const restored = next.core
    clients.push(restored)
    const listed = await restored.request(METHODS.spacesList, {})
    expect(listed.spaces.map((space) => space.path)).toEqual([worktree])
    expect(listed.spaces.map((space) => space.id)).toEqual([spaceId])
    expect(listed.tabs).toEqual([{ id, spaceId, spacePath: worktree, kind: 'terminal', label: null, alive: true, exitCode: null }])
    expect(await shellDirectory(restored, id)).toBe(worktree)
  })

  it('still restores the other saved tab when the holder rejects one tab create', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'space-')))
    await core.request(METHODS.spacesAdd, { path: space })

    core.close()
    clients = []
    await stopHolder(holder)
    holder = undefined
    await waitForCoreGone()

    // The saved state lists 'dup0001' twice. The first record restores; the holder then rejects the
    // second create (tab already exists), which must not stop the record after it.
    fs.writeFileSync(
      path.join(home, 'state.json'),
      JSON.stringify({
        version: 1,
        spaces: [{ path: space }],
        tabs: [
          { id: 'dup0001', spacePath: space },
          { id: 'dup0001', spacePath: space },
          { id: 'other001', spacePath: space },
        ],
      }),
    )

    const next = await startStack()
    holder = next.holder
    clients.push(next.core)
    const listed = await next.core.request(METHODS.spacesList, {})
    expect(listed.tabs.find((tab) => tab.id === 'dup0001')?.alive).toBe(true)
    expect(listed.tabs.find((tab) => tab.id === 'other001')?.alive).toBe(true)
    expect(await shellDirectory(next.core, 'other001')).toBe(space)
  })

  it('lists each tab with its kind and label, and a shell tab with no label as terminal and null', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const service = new SpacesService(path.join(home, 'service.json'))
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'labels-')))
    const { id: spaceId } = await service.add(space)

    const plain = await service.openTab(spaceId, 80, 24, holderClient)
    const named = await service.openTab(spaceId, 80, 24, holderClient, 'api fix')
    service.saveAgentTab({ id: 'claude01', spaceId, spacePath: space, agent: 'claude', label: 'review' })

    const listed = await service.list(holderClient)
    expect(listed.tabs).toEqual([
      { id: plain.id, spaceId, spacePath: space, kind: 'terminal', label: null, alive: true, exitCode: null },
      { id: named.id, spaceId, spacePath: space, kind: 'terminal', label: 'api fix', alive: true, exitCode: null },
      { id: 'claude01', spaceId, spacePath: space, kind: 'claude', label: 'review', alive: false, exitCode: null },
    ])
    service.rename(plain.id, 'renamed')
    expect((await service.list(holderClient)).tabs.find((tab) => tab.id === plain.id)?.label).toBe('renamed')
  })

  it('renames a tab: trims the label, clears it on a blank one, and rejects one over 80 characters', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const file = path.join(home, 'rename.json')
    const service = new SpacesService(file)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'rename-')))
    const { id: spaceId } = await service.add(space)
    const { id } = await service.openTab(spaceId, 80, 24, holderClient)
    const labelOf = async () => (await service.list(holderClient)).tabs.find((tab) => tab.id === id)?.label

    service.rename(id, '  api fix  ')
    expect(await labelOf()).toBe('api fix')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tabs).toEqual([{ id, spaceId, spacePath: space, label: 'api fix' }])

    service.rename(id, '')
    expect(await labelOf()).toBeNull()
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tabs).toEqual([{ id, spaceId, spacePath: space }])

    service.rename(id, 'a'.repeat(80))
    expect(await labelOf()).toBe('a'.repeat(80))
    const error = (() => {
      try {
        service.rename(id, 'a'.repeat(81))
        return undefined
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(RpcError)
    expect((error as RpcError).code).toBe(ERROR_CODES.invalidParams)
    expect(await labelOf()).toBe('a'.repeat(80))

    expect(() => service.rename('nope0001', 'x')).toThrow('no such tab: nope0001')
  })

  it('keeps a tab name after a restart of the core', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const file = path.join(home, 'named.json')
    const service = new SpacesService(file)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'named-')))
    const { id: spaceId } = await service.add(space)
    const { id } = await service.openTab(spaceId, 80, 24, holderClient)
    service.rename(id, 'api fix')

    const restarted = new SpacesService(file)
    await restarted.restore(holderClient)
    expect((await restarted.list(holderClient)).tabs.find((tab) => tab.id === id)?.label).toBe('api fix')
  })

  it('refuses to rename while the state is refused, and leaves the file as it was', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const file = path.join(home, 'refused.json')
    const refused = JSON.stringify({ version: 2, spaces: [], tabs: [{ id: 'keep0001', spacePath: '/x' }] })
    fs.writeFileSync(file, refused)
    const service = new SpacesService(file)

    expect(() => service.rename('keep0001', 'x')).toThrow('version 2')
    expect(fs.readFileSync(file, 'utf8')).toBe(refused)
  })

  it('starts a shell tab with the environment it is given', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const service = new SpacesService(path.join(home, 'env.json'))
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'env-')))
    const { id: spaceId } = await service.add(space)

    const { id } = await service.openTab(spaceId, 200, 24, holderClient, undefined, { GROVE_TEST_ENV: 'env-7' })
    await holderClient.request(METHODS.tabsWrite, {
      id,
      dataB64: bytesToB64(Buffer.from('echo "got=$GROVE_TEST_ENV=end"\n')),
    })
    const screen = await waitFor(
      () => screenText(holderClient, id),
      (text) => text.includes('got=env-7=end'),
    )
    expect(screen).toContain('got=env-7=end')
  })

  it('removes a saved tab, and a new stack does not recreate it after its holder tab is gone', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const file = path.join(home, 'service.json')
    const service = new SpacesService(file)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'remove-')))
    const { id: spaceId } = await service.add(space)
    const { id } = await service.openTab(spaceId, 80, 24, holderClient)

    service.removeTab(id)
    expect(service.tabRecord(id)).toBeUndefined()
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tabs).toEqual([])
    await holderClient.request(METHODS.tabsKill, { id })

    const next = new SpacesService(file)
    expect(await next.restore(holderClient)).toBe(0)
    expect((await holderClient.request(METHODS.tabsList, {})).some((tab) => tab.id === id)).toBe(false)
    expect((await next.list(holderClient)).tabs).toEqual([])
  })

  it('adds the same folder twice as two spaces, with ids the path and path#2, and lists both', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'twice-')))

    const first = await core.request(METHODS.spacesAdd, { path: space })
    const second = await core.request(METHODS.spacesAdd, { path: space })
    expect(first).toMatchObject({ path: space })
    expect(second).toMatchObject({ path: space })
    expect(first.id).toMatch(/^sp_[0-9a-f]{12}$/)
    expect(second.id).not.toBe(first.id)
    const listed = await core.request(METHODS.spacesList, {})
    expect(listed.spaces.map((item) => item.id)).toEqual([first.id, second.id])
    expect(listed.spaces.map((item) => item.path)).toEqual([space, space])
  })

  it('opens a tab in the second space of a folder: it lists under that space and starts in the folder', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'second-')))
    await core.request(METHODS.spacesAdd, { path: space })
    const { id: secondId } = await core.request(METHODS.spacesAdd, { path: space })

    const { id } = await core.request(METHODS.tabsOpen, { spaceId: secondId, cols: 80, rows: 24 })
    expect(await shellDirectory(core, id)).toBe(space)
    const listed = await core.request(METHODS.spacesList, {})
    expect(listed.tabs).toEqual([{ id, spaceId: secondId, spacePath: space, kind: 'terminal', label: null, alive: true, exitCode: null }])
  })

  it('loads a state file with no ids: spaces get their paths as ids and tabs attach to the first space of their path', async () => {
    const stack = await startStack()
    holder = stack.holder
    clients.push(stack.core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const a = fs.realpathSync(fs.mkdtempSync(path.join(root, 'old-a-')))
    const b = fs.realpathSync(fs.mkdtempSync(path.join(root, 'old-b-')))
    const file = path.join(home, 'old.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        spaces: [{ path: a }, { path: b }, { path: a }],
        tabs: [
          { id: 'old00001', spacePath: a },
          { id: 'old00002', spacePath: b },
        ],
      }),
    )

    const listed = await new SpacesService(file).list(holderClient)
    expect(listed.spaces.map((space) => [space.id, space.path])).toEqual([
      [a, a],
      [b, b],
      [`${a}#2`, a],
    ])
    expect(listed.tabs.map((tab) => [tab.id, tab.spaceId])).toEqual([
      ['old00001', a],
      ['old00002', b],
    ])
  })

  it('renames a tab in the second space of a folder', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const space = fs.realpathSync(fs.mkdtempSync(path.join(root, 'rename-second-')))
    await core.request(METHODS.spacesAdd, { path: space })
    const { id: secondId } = await core.request(METHODS.spacesAdd, { path: space })
    const { id } = await core.request(METHODS.tabsOpen, { spaceId: secondId, cols: 80, rows: 24 })

    expect(await core.request(METHODS.tabsRename, { id, label: 'second' })).toEqual({})
    expect((await core.request(METHODS.spacesList, {})).tabs).toContainEqual(
      expect.objectContaining({ id, spaceId: secondId, label: 'second' }),
    )
  })

  it('refuses tabs.open for a space id that does not exist', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const holderClient = await connectRpc(holderSocketPath())
    clients.push(holderClient)
    const service = new SpacesService(path.join(home, 'unknown.json'))

    await expect(core.request(METHODS.tabsOpen, { spaceId: '/nowhere', cols: 80, rows: 24 })).rejects.toThrow(
      'no such space: /nowhere',
    )
    const error = await service.openTab('/nowhere', 80, 24, holderClient).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(RpcError)
    expect((error as RpcError).code).toBe(ERROR_CODES.invalidParams)
    expect((error as Error).message).toBe('no such space: /nowhere')
  })
})
