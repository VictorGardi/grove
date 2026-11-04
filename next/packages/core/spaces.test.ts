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
import { coreSocketPath } from '../protocol/paths.ts'
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
    git(main, ['init', '-q'])
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
    await core.request(METHODS.spacesAdd, { path: space })

    const { id } = await core.request(METHODS.tabsOpen, { spacePath: fs.realpathSync(space), cols: 80, rows: 24 })
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

    await core.request(METHODS.spacesAdd, { path: main })
    await core.request(METHODS.spacesAdd, { path: worktree })
    const both = await core.request(METHODS.spacesList, {})
    expect(both.spaces).toContainEqual({ path: worktree, name: 'widgets-feature', repoName: 'widgets', parent: main })
    expect(both.spaces).toContainEqual({ path: main, name: 'widgets', repoName: 'widgets', parent: null })
    expect(both.refused).toBeNull()

    // Only the worktree is a space now (a fresh stack reads the same file).
    await stopHolder(holder)
    holder = undefined
    await waitForCoreGone()
    fs.rmSync(path.join(home, 'state.json'))
    const again = await startStack()
    holder = again.holder
    clients.push(again.core)
    await again.core.request(METHODS.spacesAdd, { path: worktree })
    const alone = await again.core.request(METHODS.spacesList, {})
    expect(alone.spaces).toEqual([
      { path: worktree, name: 'widgets-feature', repoName: 'widgets', parent: null },
    ])
  })

  it('restores the same space and tab id, with a live shell in the space root, after a full restart', async () => {
    const stack = await startStack()
    holder = stack.holder
    const core = stack.core
    clients.push(core)
    const { worktree } = makeRepo()
    await core.request(METHODS.spacesAdd, { path: worktree })
    const { id } = await core.request(METHODS.tabsOpen, { spacePath: worktree, cols: 80, rows: 24 })
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
    expect(listed.tabs).toEqual([{ id, spacePath: worktree, alive: true, exitCode: null }])
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
})
