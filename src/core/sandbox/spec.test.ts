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
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: PATHS })).toEqual([
      '/home/u/.claude/settings.json',
      '/home/u/.claude/.credentials.json',
      '/home/u/.gitconfig',
      '/app/out/main/cli.js',
    ])
  })

  it('carves a worktree’s hooks and config out of its read-write common dir', () => {
    expect(readOnlyPathsFor('claude', { commonDir: '/repo/.git', paths: PATHS })).toEqual([
      '/repo/.git/hooks',
      '/repo/.git/config',
      '/home/u/.claude/settings.json',
      '/home/u/.claude/.credentials.json',
      '/home/u/.gitconfig',
      '/app/out/main/cli.js',
    ])
  })

  it('makes an opencode session’s state dir read-only, and a claude session’s nothing', () => {
    expect(readOnlyPathsFor('opencode', { commonDir: null, paths: PATHS })).toContain('/home/u/.local/state/opencode')
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: PATHS })).not.toContain('/home/u/.local/state/opencode')
  })

  // D8: the agent can read the human's authority — its settings, its login — but never rewrite
  // it. A writable settings.json is a hook that runs in every later *unsandboxed* session.
  it('carves the authority-carrying files out, per agent, and never the other agent’s', () => {
    const claude = readOnlyPathsFor('claude', { commonDir: null, paths: PATHS })
    expect(claude).toContain('/home/u/.claude/settings.json')
    expect(claude).toContain('/home/u/.claude/.credentials.json')
    expect(claude).not.toContain('/home/u/.local/share/opencode/auth.json')
    const opencode = readOnlyPathsFor('opencode', { commonDir: null, paths: PATHS })
    expect(opencode).toContain('/home/u/.local/share/opencode/auth.json')
    expect(opencode.some((p) => p.startsWith('/home/u/.claude'))).toBe(false)
  })

  it('carries no carve-out for a path that was never resolved', () => {
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: { socketPath: '/data/grove.sock' } })).toEqual([])
    expect(readOnlyPathsFor('claude', { commonDir: null, paths: { socketPath: '/s', claudeHome: '/home/u/.claude' } })).toEqual([
      '/home/u/.claude/settings.json',
      '/home/u/.claude/.credentials.json',
    ]) // opencode's auth.json, whose parent dir was never resolved, contributes nothing
  })
})

describe('envFor', () => {
  it('carries the socket, the session id, a TERM the image knows and hooks neutralised', () => {
    expect(envFor('claude', SESSION, { paths: PATHS }).env).toMatchObject({
      GROVE_SESSION_ID: 'a',
      GROVE_SOCKET: '/data/grove.sock',
      TERM: 'xterm-256color',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/etc/grove/no-hooks',
    })
  })

  // D8: the container runs uid=0 with HOME=/root, so the config grove already mounts is never
  // read without a pointer at it — the mounts were there all along and inert.
  it('points claude at the config dir grove already mounts, and forwards its token bare', () => {
    expect(envFor('claude', SESSION, { paths: PATHS })).toEqual({
      env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/home/u/.claude' }),
      passEnv: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    })
  })

  it('points opencode at its own XDG dirs, derived from the mounts it already has', () => {
    expect(envFor('opencode', SESSION, { paths: PATHS })).toEqual({
      env: expect.objectContaining({ XDG_DATA_HOME: '/home/u/.local/share', XDG_CONFIG_HOME: '/home/u/.config' }),
      passEnv: [],
    })
  })

  it('gives each agent the other’s no pointer to set', () => {
    const claude = envFor('claude', SESSION, { paths: PATHS })
    const opencode = envFor('opencode', SESSION, { paths: PATHS })
    expect(claude.env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude')
    expect(opencode.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(opencode.env.XDG_DATA_HOME).toBe('/home/u/.local/share')
    expect(claude.env.XDG_DATA_HOME).toBeUndefined()
    expect(claude.passEnv).not.toEqual([])
    expect(opencode.passEnv).toEqual([]) // the free tier needs no credential, so nothing is forwarded
  })

  it('sets no pointer to a path that was never resolved', () => {
    const { env, passEnv } = envFor('claude', SESSION, { paths: { socketPath: '/s.sock' } })
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env.GROVE_SOCKET).toBe('/s.sock')
    expect(passEnv).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) // still forwarded: the channel does not depend on a mount
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
      env: envFor('claude', SESSION, { paths: PATHS }).env,
      passEnv: envFor('claude', SESSION, { paths: PATHS }).passEnv,
      cliBundle: '/app/out/main/cli.js',
    })
  })

  it('threads passEnv through, so a bare -e reaches the argv', () => {
    expect(spec('/w', null).passEnv).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'])
  })

  it('carries the credential it was probed for, and no field at all without one', () => {
    expect(specFor({ kind: 'claude', cwd: '/w', commonDir: null, paths: PATHS, session: SESSION, container: 'c', image: 'i', credential: 'CLAUDE_CODE_OAUTH_TOKEN' }).credential).toBe('CLAUDE_CODE_OAUTH_TOKEN')
    expect('credential' in spec('/w', null)).toBe(false)
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