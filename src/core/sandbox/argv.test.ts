import { describe, expect, it } from 'vitest'
import { sandboxArgv } from './argv'
import type { SandboxSpec } from './spec'

const SPEC: SandboxSpec = {
  container: 'container',
  image: 'grove-sandbox:abc123def456',
  cwd: '/w',
  mounts: ['/w:/w', '/s:/s'],
  readOnlyPaths: ['/g', '/c.js'],
  env: { GROVE_SESSION_ID: 'a', TERM: 'xterm-256color' },
  cliBundle: '/app/out/main/cli.js',
}

describe('sandboxArgv', () => {
  it('wraps the agent argv in a named, working-directory container run', () => {
    expect(sandboxArgv({ name: 'grove-1', spec: SPEC, agentArgv: ['claude', '-s', 'x'] })).toEqual([
      'container',
      'run',
      '--rm',
      '-i',
      '-t',
      '--name',
      'grove-1',
      '--workdir',
      '/w',
      '--volume',
      '/w:/w',
      '--volume',
      '/s:/s',
      '--read-only-path',
      '/g',
      '--read-only-path',
      '/c.js',
      '-e',
      'GROVE_SESSION_ID=a',
      '-e',
      'TERM=xterm-256color',
      '-e',
      'GROVE_CLI_BUNDLE=/app/out/main/cli.js',
      'grove-sandbox:abc123def456',
      'claude',
      '-s',
      'x',
    ])
  })

  it('passes no bundle path when the spec carries none', () => {
    const argv = sandboxArgv({ name: 'grove-1', spec: { ...SPEC, cliBundle: undefined }, agentArgv: ['claude'] })
    expect(argv.some((a) => a.startsWith('GROVE_CLI_BUNDLE='))).toBe(false)
  })

  it('puts the image last before the agent, so the agent argv is never read as flags', () => {
    const argv = sandboxArgv({ name: 'grove-1', spec: SPEC, agentArgv: ['claude', '--prompt', '-x'] })
    expect(argv.slice(-4)).toEqual(['grove-sandbox:abc123def456', 'claude', '--prompt', '-x'])
  })
})