import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpacesService } from './spaces.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=grove', '-c', 'user.email=grove@example.invalid', ...args], { cwd, stdio: 'pipe' })

describe('worktree spaces', () => {
  let root: string
  let main: string
  let service: SpacesService

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-')))
    main = path.join(root, 'widgets')
    fs.mkdirSync(main)
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'init'])
    fs.mkdirSync(path.join(root, 'home'))
    service = new SpacesService(path.join(root, 'home', 'state.json'), path.join(root, 'worktrees'))
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('creates a worktree space under <root>/<repo>/<branch>, nested under its repo space', async () => {
    const repo = await service.add(main)
    const created = await service.addWorktreeSpace(repo.id, 'feature/login')
    expect(created.path).toBe(path.join(root, 'worktrees', 'widgets', 'feature-login'))
    expect(created.parent).toBe(repo.id)
    expect(created.branch).toBe('feature/login')
    expect(fs.existsSync(created.path)).toBe(true)
  })

  it('checks out a branch that exists instead of making a new one', async () => {
    git(main, ['branch', 'old'])
    const repo = await service.add(main)
    const created = await service.addWorktreeSpace(repo.id, 'old')
    expect(created.branch).toBe('old')
  })

  it('refuses a bad branch name, a folder that exists, and a space outside git', async () => {
    const repo = await service.add(main)
    await expect(service.addWorktreeSpace(repo.id, 'a b')).rejects.toThrow('not a valid branch name')
    await service.addWorktreeSpace(repo.id, 'dup')
    await expect(service.addWorktreeSpace(repo.id, 'dup')).rejects.toThrow('already exists')
    const plain = await service.add(fs.mkdtempSync(path.join(root, 'plain-')))
    await expect(service.addWorktreeSpace(plain.id, 'x')).rejects.toThrow('not a git repository')
  })

  it('lists the worktrees that are not spaces yet', async () => {
    const repo = await service.add(main)
    const other = path.join(root, 'elsewhere')
    git(main, ['worktree', 'add', '-q', '-b', 'other', other])
    expect(await service.unopenedWorktrees(repo.id)).toEqual([{ path: other, branch: 'other' }])
    await service.add(other)
    expect(await service.unopenedWorktrees(repo.id)).toEqual([])
  })

  it('removes the checkout of a worktree space, keeps the branch, and refuses a main checkout or a dirty one', async () => {
    const repo = await service.add(main)
    await expect(service.removeWorktreeFolder(repo.id)).rejects.toThrow('is not a worktree')
    const created = await service.addWorktreeSpace(repo.id, 'gone')
    fs.writeFileSync(path.join(created.path, 'dirty.txt'), 'x')
    await expect(service.removeWorktreeFolder(created.id)).rejects.toThrow()
    expect(fs.existsSync(created.path)).toBe(true)
    fs.rmSync(path.join(created.path, 'dirty.txt'))
    await service.removeWorktreeFolder(created.id)
    expect(fs.existsSync(created.path)).toBe(false)
    expect(git(main, ['branch', '--list', 'gone']).toString()).toContain('gone')
  })

  it('removes a space record and renames a space with a display name that clears when empty', async () => {
    const repo = await service.add(main)
    service.renameSpace(repo.id, '  Widgets  ')
    expect((await service.list({ request: async () => [] } as never)).spaces[0]).toMatchObject({ name: 'Widgets', label: 'Widgets' })
    service.renameSpace(repo.id, '')
    expect((await service.list({ request: async () => [] } as never)).spaces[0]).toMatchObject({ name: 'widgets', label: null })
    service.removeSpace(repo.id)
    expect(service.isSpace(repo.id)).toBe(false)
    expect(() => service.removeSpace(repo.id)).toThrow('no such space')
  })
})
