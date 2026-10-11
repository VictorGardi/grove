import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newSession } from '../sessions'
import { envFor, mountsFor, readOnlyPathsFor, specFor, type MountPaths } from './spec'

const PATHS: MountPaths = {
  claudeHome: '/home/u/.claude',
  claudeJson: '/home/u/.claude.json',
  opencodeShare: '/home/u/.local/share/opencode',
  opencodeConfig: '/home/u/.config/opencode',
  opencodeState: '/home/u/.local/state/opencode',
  opencodeServiceConfig: '/home/u/.local/state/opencode/service.json',
  gitconfig: '/home/u/.gitconfig',
  spoolDir: '/data/agents/claude',
  socketPath: '/data/grove.sock',
  cliBundle: '/app/out/main/cli.js',
}

const SESSION = newSession({ projectId: 'p', kind: 'claude', now: new Date(), id: 'a', agentSessionId: 'u' })

describe('mountsFor', () => {
  it('binds the working directory and everything a claude session needs, at host paths', () => {
    expect(mountsFor('claude', { cwd: '/w', commonDir: null, paths: PATHS })).toEqual([
      '/w:/w',
      '/home/u/.claude:/home/u/.claude',
      '/home/u/.claude.json:/home/u/.claude.json',
      '/data/agents/claude:/data/agents/claude',
      '/data/grove.sock:/data/grove.sock',
      '/app/out/main/cli.js:/app/out/main/cli.js',
    ])
  })

  it('binds a common dir of its own second, when the session is in a worktree', () => {
    expect(mountsFor('claude', { cwd: '/wt', commonDir: '/repo/.git', paths: PATHS }).slice(0, 2)).toEqual([
      '/wt:/wt',
      '/repo/.git:/repo/.git',
    ])
  })

  it('binds opencode’s own directories for an opencode session, not claude’s', () => {
    const mounts = mountsFor('opencode', { cwd: '/w', commonDir: null, paths: PATHS })
    expect(mounts).toContain('/home/u/.local/share/opencode:/home/u/.local/share/opencode')
    expect(mounts).toContain('/home/u/.config/opencode:/home/u/.config/opencode')
    expect(mounts.some((m) => m.startsWith('/home/u/.claude'))).toBe(false)
  })

  it('skips a path that was never resolved rather than mounting "undefined"', () => {
    const mounts = mountsFor('claude', { cwd: '/w', commonDir: null, paths: { socketPath: '/data/grove.sock' } })
    expect(mounts).toEqual(['/w:/w', '/data/grove.sock:/data/grove.sock'])
  })
})

describe('readOnlyPathsFor', () => {
  it('is the gitconfig and the CLI bundle when the common dir needs no volume', () => {
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: PATHS })).toEqual(['/home/u/.gitconfig', '/app/out/main/cli.js'])
  })

  it('carves a worktree’s hooks and config out of its read-write common dir', () => {
    expect(readOnlyPathsFor('claude', { commonDir: '/repo/.git', paths: PATHS })).toEqual([
      '/repo/.git/hooks',
      '/repo/.git/config',
      '/home/u/.gitconfig',
      '/app/out/main/cli.js',
    ])
  })

  it('makes an opencode session’s state dir read-only, and a claude session’s nothing', () => {
    expect(readOnlyPathsFor('opencode', { commonDir: null, paths: PATHS })).toContain('/home/u/.local/state/opencode')
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: PATHS })).not.toContain('/home/u/.local/state/opencode')
  })

  it('carries no read-only path for a path that was never resolved', () => {
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: { socketPath: '/data/grove.sock' } })).toEqual([])
  })
})

describe('envFor', () => {
  it('carries the socket, the session id, a TERM the image knows and hooks neutralised', () => {
    expect(envFor(SESSION, { socketPath: '/s.sock' })).toEqual({
      GROVE_SESSION_ID: 'a',
      GROVE_SOCKET: '/s.sock',
      TERM: 'xterm-256color',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/etc/grove/no-hooks',
    })
  })
})

describe('specFor', () => {
  const spec = (cwd: string, commonDir: string | null) =>
    specFor({ kind: 'claude', cwd, commonDir, paths: PATHS, session: SESSION, container: 'container', image: 'grove-sandbox:abc' })

  it('assembles the image, the mounts, the read-only paths and the env', () => {
    expect(spec('/w', null)).toEqual({
      container: 'container',
      image: 'grove-sandbox:abc',
      cwd: '/w',
      mounts: mountsFor('claude', { cwd: '/w', commonDir: null, paths: PATHS }),
      readOnlyPaths: readOnlyPathsFor('claude', { commonDir: null, paths: PATHS }),
      env: envFor(SESSION, { socketPath: '/data/grove.sock' }),
      cliBundle: '/app/out/main/cli.js',
    })
  })

  it('mounts no git dir of its own when the common dir is already inside the working directory', () => {
    // a plain checkout: `.git` is below cwd, so the working-directory volume already carries it
    expect(spec('/repo', path.join('/repo', '.git')).mounts).toEqual(spec('/repo', null).mounts)
    expect(spec('/repo', path.join('/repo', '.git')).readOnlyPaths).toEqual(spec('/repo', null).readOnlyPaths)
  })

  it('mounts the common dir of its own when the session starts in a subfolder of a checkout', () => {
    expect(spec('/repo/src', '/repo/.git').mounts.slice(0, 2)).toEqual(['/repo/src:/repo/src', '/repo/.git:/repo/.git'])
  })

  it('carries no cliBundle when the bundle was not resolved', () => {
    const s = specFor({
      kind: 'claude',
      cwd: '/w',
      commonDir: null,
      paths: { socketPath: '/s.sock' },
      session: SESSION,
      container: 'container',
      image: 'grove-sandbox:abc',
    })
    expect('cliBundle' in s).toBe(false)
  })
})