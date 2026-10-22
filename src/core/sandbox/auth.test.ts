import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loginShellCredential } from './auth'

// A stand-in for the user's login shell. grove probes it with
// `<shell> -l -i -c 'echo ${VAR:-}'`, so the script reads the variable out of that command,
// records that it was asked, and then answers however the test wants it to — no real shell, no
// real profile, and no real token anywhere in sight.
function fakeShell(body: string): { shell: string; asked: () => string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-auth-'))
  const askedFile = path.join(dir, 'asked')
  fs.writeFileSync(
    path.join(dir, 'fake-shell'),
    `#!/bin/sh
name=\${4#'echo \${'}
name=\${name%':-}'}
echo "$name" >> ${JSON.stringify(askedFile)}
${body}
`,
    { mode: 0o755 },
  )
  return {
    shell: path.join(dir, 'fake-shell'),
    asked: () => (fs.existsSync(askedFile) ? fs.readFileSync(askedFile, 'utf8').trim().split('\n').filter(Boolean) : []),
  }
}

const temps: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-auth-'))
  temps.push(d)
  return d
}
afterEach(() => temps.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const SET = (v: string) => `case "$name" in ${v}) printf 'set' ;; esac`

describe('loginShellCredential — claude', () => {
  it('names the variable the login shell carries, and stops at the first candidate', async () => {
    const { shell, asked } = fakeShell(SET('CLAUDE_CODE_OAUTH_TOKEN | ANTHROPIC_API_KEY'))
    expect(await loginShellCredential('claude', { shell })).toBe('CLAUDE_CODE_OAUTH_TOKEN')
    expect(asked()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']) // the second candidate was never asked
  })

  it('falls through to the second candidate when the first is unset', async () => {
    const { shell, asked } = fakeShell(SET('ANTHROPIC_API_KEY'))
    expect(await loginShellCredential('claude', { shell })).toBe('ANTHROPIC_API_KEY')
    expect(asked()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'])
  })

  it('accepts the file CLAUDE_CONFIG_DIR already reaches when no variable is set', async () => {
    const { shell } = fakeShell('exit 0')
    expect(await loginShellCredential('claude', { shell, claudeHome: path.join(tmp(), 'never-resolved') })).toBeNull()

    const claudeHome = path.join(tmp(), '.claude')
    fs.mkdirSync(claudeHome, { recursive: true })
    expect(await loginShellCredential('claude', { shell, claudeHome })).toBeNull() // the directory alone is not a login
    fs.writeFileSync(path.join(claudeHome, '.credentials.json'), '{}')
    expect(await loginShellCredential('claude', { shell, claudeHome })).toBe('~/.claude/.credentials.json')
  })

  it('prefers the variable over the file, a set variable being the more explicit channel', async () => {
    const claudeHome = path.join(tmp(), '.claude')
    fs.mkdirSync(claudeHome, { recursive: true })
    fs.writeFileSync(path.join(claudeHome, '.credentials.json'), '{}')
    const { shell } = fakeShell(SET('CLAUDE_CODE_OAUTH_TOKEN'))
    expect(await loginShellCredential('claude', { shell, claudeHome })).toBe('CLAUDE_CODE_OAUTH_TOKEN')
  })

  // A pane that cannot log in is exactly what D8 exists to prevent, so every way the probe can
  // fail reads as "not found" — never a throw, and never a guess.
  it('treats a missing shell, a failing shell and empty output as not found, never a throw', async () => {
    expect(await loginShellCredential('claude', { shell: path.join(tmp(), 'no-such-shell') })).toBeNull()
    expect(await loginShellCredential('claude', { shell: fakeShell('exit 3').shell })).toBeNull()
    expect(await loginShellCredential('claude', { shell: fakeShell('echo noise >&2').shell })).toBeNull()
  })
})

describe('loginShellCredential — opencode', () => {
  // OpenCode cannot reach the no-credential state (D8): the Zen free tier authenticates by the
  // client being opencode, and a host login lands in the auth.json grove already mounts. So the
  // probe answers from what is always true, without spawning anything.
  it('answers from what is always true, without spawning a shell', async () => {
    const { shell, asked } = fakeShell('exit 1')
    expect(await loginShellCredential('opencode', { shell })).toBe("the host's opencode auth.json, or the free tier")
    expect(asked()).toEqual([])
  })

  it('still answers when there is no shell at all to spawn', async () => {
    expect(await loginShellCredential('opencode', { shell: path.join(tmp(), 'no-such-shell') })).toBe(
      "the host's opencode auth.json, or the free tier",
    )
  })
})
describe('loginShellCredential — copilot', () => {
  it('finds nothing to forward, and spawns nothing', async () => {
    const { shell, asked } = fakeShell(SET('CLAUDE_CODE_OAUTH_TOKEN'))
    expect(await loginShellCredential('copilot', { shell })).toBeNull()
    expect(asked()).toEqual([])
  })
})
