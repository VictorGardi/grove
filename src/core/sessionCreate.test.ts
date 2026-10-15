import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { opencodeCliConfig } from '@shared/opencodeSession'
import { SpoolClaude } from './claude/source'
import { claudeArgv } from './claude/hooks'
import { gitRunner } from './diff/git'
import { minimalEnv } from './env'
import { imageRef } from './sandbox/image'
import { loadState } from './store/stateStore'
import type { Core } from './core'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'
import { add as addWorktree, worktreePath } from './worktrees'

const created = (fake: { calls: { method: string; args: unknown[] }[] }) =>
  fake.calls.filter((c) => c.method === 'create').map((c) => c.args[0] as { cwd: string; argv?: string[]; env?: Record<string, string> })

// `container network ls --format json`, in the shape the real CLI prints: the network's name under
// `configuration`, the address grove binds the host service to under `status`.
const NETWORKS = JSON.stringify([{ configuration: { name: 'default' }, status: { ipv4Gateway: '192.168.64.1' } }])

describe('sessionCreate for the CLI', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  async function start() {
    fs.mkdirSync(path.join(t.dir, 'docs', 'work', 'a'), { recursive: true })
    fs.writeFileSync(path.join(t.dir, 'docs', 'work', 'a', 'feature.md'), '---\nkind: feature\n---\n# a\n')
    fs.mkdirSync(path.join(t.dir, 'sub'))
    const core = t.make()
    await core.start()
    return core
  }
  const create = (core: Awaited<ReturnType<typeof start>>, a: Record<string, unknown>) =>
    core.commands.sessionCreate({ kind: 'terminal', cols: 120, rows: 40, ...a })

  it('carries the prompt per kind: opencode --prompt, claude --name then the text', async () => {
    const core = await start()
    await create(core, { cwd: t.dir, kind: 'opencode', prompt: 'say hi' })
    await create(core, { cwd: t.dir, kind: 'claude', prompt: 'say hi', label: 'helper' })
    const [oc, cl] = created(t.fake)
    expect(oc.argv![4]).toMatch(/^exec opencode -s ses_\S+ --prompt 'say hi'$/)
    expect(cl.argv![4]).toMatch(/^exec claude -s \S+ --name helper --prompt 'say hi'$/) // the fake source's argv
  })

  it('claude: name then prompt, and a prompt starting with - follows --', () => {
    const argv = claudeArgv('id', '/spool', 'start', undefined, { prompt: '-x', name: 'n' })
    expect(argv.slice(-4)).toEqual(['--name', 'n', '--', '-x'])
    expect(claudeArgv('id', '/spool', 'start', undefined, { prompt: 'hi' }).at(-1)).toBe('hi')
    expect(claudeArgv('id', '/spool', 'resume').includes('--name')).toBe(false)
  })

  it('real claude source: label becomes --name', async () => {
    const claudeDir = path.join(t.dir, 'agents', 'claude')
    const core = t.make(undefined, { sources: [t.oc, new SpoolClaude({ dir: claudeDir })] })
    await core.start()
    await create(core, { cwd: t.dir, kind: 'claude', prompt: 'p q', label: 'helper' })
    expect(created(t.fake)[0].argv![4]).toMatch(/--name helper 'p q'$/)
  })

  it('claude: --model after --settings on start and resume, and launchModel survives a restart', async () => {
    const argv = claudeArgv('id', '/spool', 'start', undefined, { model: 'm1', name: 'n' })
    expect(argv.slice(argv.indexOf('--settings') + 2, argv.indexOf('--settings') + 6)).toEqual(['--model', 'm1', '--name', 'n'])
    expect(claudeArgv('id', '/spool', 'resume', undefined, { model: 'm1' }).slice(-2)).toEqual(['--model', 'm1'])
    expect(claudeArgv('id', '/spool', 'resume').includes('--model')).toBe(false)

    const claudeDir = path.join(t.dir, 'agents', 'claude')
    const sources = () => ({ sources: [t.oc, new SpoolClaude({ dir: claudeDir })] })
    const core = t.make(undefined, sources())
    await core.start()
    const plain = await create(core, { cwd: t.dir, kind: 'claude' })
    const res = await create(core, { cwd: t.dir, kind: 'claude', model: 'm1' })
    if (!plain.ok || !res.ok) throw new Error('create failed')
    expect(created(t.fake)[0].argv![4]).not.toContain('--model')
    expect(plain.data).not.toHaveProperty('launchModel')
    expect(created(t.fake)[1].argv![4]).toContain('--model m1')
    expect(res.data.launchModel).toBe('m1')

    await core.commands.sessionKill({ id: res.data.id })
    await core.commands.sessionResume({ id: res.data.id })
    expect(created(t.fake)[2].argv![4]).toMatch(/--resume \S+ .*--model m1/)

    core.dispose()
    expect(loadState(t.statePath).sessions.find((s) => s.id === res.data.id)?.launchModel).toBe('m1')
    const restarted = t.make(undefined, sources())
    await restarted.start()
    expect(restarted.getSlices().sessions.find((s) => s.id === res.data.id)?.launchModel).toBe('m1')
  })

  it('stores the folder for a subfolder, null for the project path, and starts the backend there', async () => {
    const core = await start()
    const sub = await create(core, { cwd: path.join(t.dir, 'sub') })
    const top = await create(core, { cwd: t.dir })
    if (!sub.ok || !top.ok) throw new Error('create failed')
    expect(sub.data.projectId).toBe('p')
    expect(sub.data.cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
    expect(top.data.cwd).toBeNull()
    expect(created(t.fake)[0].cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
    expect(created(t.fake)[1].cwd).toBe(t.dir)
  })

  it('refuses an unknown folder and creates nothing', async () => {
    const core = await start()
    expect(await create(core, { cwd: path.join(t.dir, 'missing') })).toEqual({ ok: false, error: 'not-found' })
    expect(created(t.fake)).toEqual([])
  })

  it("registers a new folder's git top level as a project", async () => {
    const core = await start()
    const repo = gitRepo()
    repo.commit()
    fs.mkdirSync(path.join(repo.dir, 'deep'))
    const res = await create(core, { cwd: path.join(repo.dir, 'deep') })
    if (!res.ok) throw new Error(res.error)
    const projects = core.getSlices().projects
    expect(projects).toHaveLength(2)
    expect(fs.realpathSync(projects[1].path)).toBe(fs.realpathSync(repo.dir))
    expect(res.data.projectId).toBe(projects[1].id)
    expect(res.data.cwd).toBe(fs.realpathSync(path.join(repo.dir, 'deep')))
  })

  // The tracer: a session in its own worktree becomes a project of its own, nested under the
  // repo's checkout, with the worktree root as its path — so every path-resolving subsystem
  // is right without a change (ADR 0037).
  it('registers a session\'s worktree as its own project, nested under the checkout', async () => {
    const core = await start()
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const checkout = await core.commands.projectAdd({ path: repo.dir })
    if (!checkout.ok) throw new Error(checkout.error)

    const wt = worktreePath(repo.dir, 'fix-auth', fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-')))
    const added = await addWorktree({ repo: repo.dir, branch: 'fix-auth', path: wt, git: gitRunner('git', minimalEnv(process.env)) })
    if (!added.ok) throw new Error(added.error)

    const res = await create(core, { cwd: wt })
    if (!res.ok) throw new Error(res.error)

    const projects = core.getSlices().projects
    const worktree = projects.find((p) => p.id === res.data.projectId)!
    expect(projects).toHaveLength(3)
    expect(fs.realpathSync(worktree.path)).toBe(fs.realpathSync(wt)) // project.path IS the worktree root
    expect(worktree.worktreeOf).toBe(checkout.data.id) // nested under the repo's checkout
    expect(res.data.cwd).toBeNull() // the session's folder is the project path, so nothing is stored
    expect(created(t.fake).at(-1)!.cwd).toBe(worktree.path) // and the pane starts in the worktree

    // config.json keeps schemaVersion 1 and carries the new field verbatim: it is additive
    // and optional, so there is no migration and no version bump (ADR 0037).
    const saved = JSON.parse(fs.readFileSync(t.configPath, 'utf8'))
    expect(saved.schemaVersion).toBe(1)
    expect(saved.projects.find((p: { id: string }) => p.id === worktree.id).worktreeOf).toBe(checkout.data.id)
    t.disposeAll()
    const again = t.make()
    await again.start()
    expect(again.getSlices().projects.find((p) => p.id === worktree.id)?.worktreeOf).toBe(checkout.data.id)
  })

  // The reason the worktree is a project: the diff of its session resolves against the
  // worktree, so it needs no fix — and the checkout the session is not in stays clean.
  it('diffs the worktree, not the checkout, and leaves the checkout clean', async () => {
    const core = await start()
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    await core.commands.projectAdd({ path: repo.dir })
    const wt = worktreePath(repo.dir, 'fix-auth', fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-')))
    const added = await addWorktree({ repo: repo.dir, branch: 'fix-auth', path: wt, git: gitRunner('git', minimalEnv(process.env)) })
    if (!added.ok) throw new Error(added.error)
    const res = await create(core, { cwd: wt })
    if (!res.ok) throw new Error(res.error)

    fs.writeFileSync(path.join(wt, 'README.md'), 'changed\n')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: res.data.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    expect(core.getSlices().diff).toMatchObject({ sessionId: res.data.id, state: 'ok', root: fs.realpathSync(wt) })
    expect(core.getSlices().diff!.files.map((f) => f.path)).toEqual(['README.md'])
    expect(execFileSync('git', ['-C', repo.dir, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
  })

  it('checks --link before creating: unknown → no-feature, nothing created or registered', async () => {
    const core = await start()
    expect(await create(core, { cwd: t.dir, feature: 'nope' })).toEqual({ ok: false, error: 'no-feature' })
    const other = fs.mkdtempSync(path.join(t.dir, '..', 'other-'))
    expect(await create(core, { cwd: other, feature: 'a' })).toEqual({ ok: false, error: 'no-feature' })
    expect(created(t.fake)).toEqual([])
    expect(core.getSlices().projects).toHaveLength(1)
  })

  it('pins a known link and a label', async () => {
    const core = await start()
    await vi.waitFor(() => expect(core.getSlices().features.items.some((f) => f.slug === 'a')).toBe(true))
    const res = await create(core, { cwd: t.dir, feature: 'a', label: 'mine' })
    expect(res).toMatchObject({ ok: true, data: { feature: 'a', linkPinned: true, label: 'mine', labelPinned: true } })
  })

  it('pastes the prompt into a terminal once the pane is stable', async () => {
    const core = await start()
    const res = await create(core, { cwd: t.dir, prompt: 'echo hi' })
    if (!res.ok) throw new Error(res.error)
    await vi.waitFor(() => expect(t.fake.pastes).toEqual([{ name: res.data.tmuxName, text: 'echo hi', submit: true }]), { timeout: 3000 })
  })

  it('resume starts a gone session in its stored folder', async () => {
    const core = await start()
    const res = await create(core, { cwd: path.join(t.dir, 'sub'), kind: 'opencode' })
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    await core.commands.sessionResume({ id: res.data.id })
    expect(created(t.fake).at(-1)!.cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
  })
})

describe('sessionCreate --sandboxed', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  const home = () => path.join(t.dir, 'home')
  const paths = () => ({
    claudeHome: path.join(home(), '.claude'),
    claudeJson: path.join(home(), '.claude.json'),
    opencodeState: path.join(home(), '.local', 'state', 'opencode'),
    opencodeRegistration: path.join(home(), '.local', 'state', 'opencode', 'service.json'),
    opencodeServiceConfig: path.join(home(), '.config', 'opencode', 'service.json'),
    gitconfig: path.join(home(), '.gitconfig'),
    spoolDir: path.join(t.dir, 'agents', 'claude'),
    socketPath: path.join(t.dir, 'grove.sock'),
    cliBundle: path.join(t.dir, 'out', 'main', 'cli.js'),
  })
  const dockerfile = () => path.join(t.dir, 'sandbox', 'Dockerfile')
  const container = () => path.join(t.dir, 'bin', 'container')

  // A `container` that finds no image, so the create takes the build path against a binary that
  // always succeeds — the real one is never touched by a test.
  // A credential grove can see, so the argv under test is the sandbox's and not a refusal (D8).
  async function start() {
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    fs.mkdirSync(paths().claudeHome, { recursive: true })
    fs.writeFileSync(path.join(paths().claudeHome, '.credentials.json'), '{}')
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    return core
  }
  const sandboxed = (core: Awaited<ReturnType<typeof start>>, a: Record<string, unknown> = {}) =>
    core.commands.sessionCreate({ kind: 'claude', sandboxed: true, cwd: t.dir, cols: 120, rows: 40, ...a })

  // The design's "Default off", asserted where the default takes effect rather than only where it
  // is written down. A Claude session created without the flag is a host session, on a machine
  // configured to sandbox — the sandbox being available must not make it the default.
  it('defaults a claude session to the host when the flag is absent', async () => {
    const core = await start()
    const res = await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sandboxed).toBe(false)
    expect(created(t.fake)[0].argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec claude -s \S+$/)
    expect(created(t.fake)[0].argv![4]).not.toContain('container run')
  })

  it('runs the agent in a named container, with the working directory and the mount set, and the agent last', async () => {
    const core = await start()
    const res = await sandboxed(core)
    if (!res.ok) throw new Error(res.error)
    const argv = created(t.fake)[0].argv![4]
    expect(argv).toMatch(
      new RegExp(`^export PATH=/bin:"\\$PATH"; exec ${container()} run --rm -i -t --name grove-[0-9a-f-]+ --workdir `),
    )
    expect(argv).toContain(`--volume ${t.dir}:${t.dir}`)
    expect(argv).toContain(`--volume ${paths().claudeHome}:${paths().claudeHome}`)
    expect(argv).toContain(`--volume ${paths().spoolDir}:${paths().spoolDir}`)
    expect(argv).toContain(`--volume ${paths().socketPath}:${paths().socketPath}`)
    expect(argv).toContain(`--read-only-path ${paths().gitconfig}`)
    expect(argv).toContain(`--read-only-path ${paths().cliBundle}`)
    expect(argv).toContain('-e GIT_CONFIG_VALUE_0=/etc/grove/no-hooks')
    expect(argv).toContain(`-e GROVE_CLI_BUNDLE=${paths().cliBundle}`)
    expect(argv).toMatch(new RegExp(`${imageRef(dockerfile())} claude -s \\S+$`))
    expect(res.data.sandboxed).toBe(true)
  })

  it('leaves an unsandboxed agent exactly as it was', async () => {
    const core = await start()
    await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    expect(created(t.fake)[0].argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec claude -s \S+$/)
  })

  it('refuses a kind it cannot sandbox, and creates nothing', async () => {
    const core = await start()
    expect(await sandboxed(core, { kind: 'terminal' })).toEqual({ ok: false, error: 'no-sandbox-kind' })
    expect(created(t.fake)).toEqual([])
  })

  // D6: both agents are sandboxable. A terminal has no agent argv to wrap, and nothing else changed.
  it('sandboxes an opencode session, pointing it at the host service rather than its own', async () => {
    const core = await startWithLog()
    register()
    const res = await sandboxed(core, { kind: 'opencode' })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sandboxed).toBe(true)
    const argv = created(t.fake)[0].argv![4]
    expect(argv).toContain(' run --rm -i -t --name ')
    // the registration has to be readable or the client starts a service of its own and evicts the
    // host's, so the state dir is both pointed at and carved out read-only
    expect(argv).toContain(`-e XDG_STATE_HOME=${path.dirname(paths().opencodeState)}`)
    expect(argv).toContain(`--read-only-path ${paths().opencodeState}`)
  })

  it('writes the bridge bind once, into the host service config', async () => {
    const core = await startWithLog()
    register()
    expect(await sandboxed(core, { kind: 'opencode' })).toMatchObject({ ok: true })
    expect(JSON.parse(fs.readFileSync(paths().opencodeServiceConfig, 'utf8'))).toEqual({ hostname: '192.168.64.1' })
  })

  // The thing that was missing: told where the service is, the client connects instead of starting
  // one of its own — and one of its own is what died with EADDRNOTAVAIL, binding the bridge address
  // grove had written into the config it can read.
  it('tells a sandboxed opencode which host service to join', async () => {
    const core = await startWithLog()
    register()
    const res = await sandboxed(core, { kind: 'opencode' })
    if (!res.ok) throw new Error(res.error)
    const argv = created(t.fake)[0].argv![4]
    expect(argv).toMatch(/opencode --server http:\/\/192\.168\.64\.1:49374 -s ses_\S+$/)
    expect(argv).toContain('-e OPENCODE_SERVER_PASSWORD=s3cret')
  })

  it('refuses no-sandbox when there is no host service registration to join', async () => {
    const core = await startWithLog()
    expect(await sandboxed(core, { kind: 'opencode' })).toEqual({ ok: false, error: 'no-sandbox-no-service' })
    expect(created(t.fake)).toEqual([])
  })

  it('leaves a sandboxed claude with no --server, and no service', async () => {
    const core = await startWithLog()
    const res = await sandboxed(core)
    if (!res.ok) throw new Error(res.error)
    const argv = created(t.fake)[0].argv![4]
    expect(argv).not.toContain('--server')
    expect(argv).not.toContain('OPENCODE_SERVER_PASSWORD')
  })

  // The container only ever sees what grove passes explicitly, so grove's own session chrome has
  // to be passed explicitly too — otherwise a sandboxed OpenCode comes up with the user's tabs and
  // theme (measured 2026-10-12).
  it('carries grove’s opencode chrome into the sandbox, and not into claude’s', async () => {
    const core = await startWithLog()
    register()
    const oc = await sandboxed(core, { kind: 'opencode' })
    if (!oc.ok) throw new Error(oc.error)
    expect(created(t.fake)[0].argv![4]).toContain(`-e 'OPENCODE_CLI_CONFIG_CONTENT=${opencodeCliConfig()}'`)

    const cl = await sandboxed(core, { kind: 'claude' })
    if (!cl.ok) throw new Error(cl.error)
    expect(created(t.fake)[1].argv![4]).not.toContain('OPENCODE_CLI_CONFIG_CONTENT')
  })

  // The guarantee behind having a function rather than two literals: a sandboxed session and a host
  // session get byte-identical chrome, because both ask the same function. If they ever stop
  // agreeing, this fails rather than the UI quietly diverging.
  it('gives a sandboxed opencode the same chrome a host one gets', async () => {
    const core = await startWithLog()
    register()
    expect((await sandboxed(core, { kind: 'opencode' })).ok).toBe(true)
    const sandboxedEnv = created(t.fake)[0].env!
    expect(sandboxedEnv?.OPENCODE_CLI_CONFIG_CONTENT).toBe(opencodeCliConfig())

    const host = await core.commands.sessionCreate({ kind: 'opencode', cwd: t.dir, cols: 120, rows: 40 })
    if (!host.ok) throw new Error(host.error)
    expect(created(t.fake)[1].env?.OPENCODE_CLI_CONFIG_CONTENT).toBe(sandboxedEnv?.OPENCODE_CLI_CONFIG_CONTENT)
  })

  it('refuses no-sandbox when the image cannot be built, rather than launching unguarded', async () => {
    // answers `--version` and fails only the build, so this is the build and not the binary
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nexit 1\n', { mode: 0o755 })
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    expect(await sandboxed(core)).toEqual({ ok: false, error: 'no-sandbox-no-image' })
    expect(created(t.fake)).toEqual([])
  })

  it('names a missing container binary as itself, before spending anything on a build', async () => {
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    fs.mkdirSync(paths().claudeHome, { recursive: true })
    fs.writeFileSync(path.join(paths().claudeHome, '.credentials.json'), '{}')
    const absent = path.join(t.dir, 'bin', 'not-installed')
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: absent, dockerfile: dockerfile() },
    })
    await core.start()
    expect(await sandboxed(core)).toEqual({ ok: false, error: 'no-sandbox-no-container' })
    expect(created(t.fake)).toEqual([])
  })

  it('sandbox needs sessionEnv and an image; without either it refuses rather than guessing', async () => {
    const bare = t.make()
    await bare.start()
    expect(await bare.commands.sessionCreate({ kind: 'claude', sandboxed: true, cwd: t.dir, cols: 120, rows: 40 })).toEqual({
      ok: false,
      error: 'no-sandbox-unconfigured',
    })
    expect(created(t.fake)).toEqual([])
  })

  it('refuses no-sandbox when the Dockerfile itself is missing, rather than throwing', async () => {
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    expect(await sandboxed(core)).toEqual({ ok: false, error: 'no-sandbox-no-image' })
    expect(created(t.fake)).toEqual([])
  })

  // The same core over a `container` that records every invocation, so the teardown commands are
  // assertable. Beside start(), not instead of it: the silent fake above is what the argv tests need.
  const containerLog = () => container() + '.log'
  const containerCalls = () => (fs.existsSync(containerLog()) ? fs.readFileSync(containerLog(), 'utf8').trim().split('\n').filter(Boolean) : [])
  const removals = () => containerCalls().filter((c) => c.startsWith('rm '))
  // The host service's own registration. Without it a sandboxed opencode has no port to point
  // `--server` at, which is `no-sandbox` (D6, human 2026-10-12).
  const register = () => {
    fs.mkdirSync(path.dirname(paths().opencodeRegistration), { recursive: true })
    fs.writeFileSync(paths().opencodeRegistration, '{"url":"http://127.0.0.1:49374","pid":1075,"password":"s3cret"}')
  }
  // What startWithLog writes: record every invocation, and answer the two read-only questions grove
  // asks — which containers exist, and what the `default` network's gateway is.
  const fakeListingScript = (listed: string[]): string =>
    [
      '#!/bin/sh',
      'echo "$@" >> ' + containerLog(),
      'if [ "$*" = "list --all --quiet" ]; then printf ' + "'%s\\n'" + ' ' + listed.map((n) => "'" + n + "'").join(' ') + '; fi',
      'if [ "$*" = "network ls --format json" ]; then printf ' +
        "'%s\\n'" +
        ' ' +
        JSON.stringify(NETWORKS) +
        '; fi',
      'exit 0',
      '',
    ].join('\n')
  async function startWithLog(listed: string[] = []) {
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), fakeListingScript(listed), { mode: 0o755 })
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    fs.mkdirSync(paths().claudeHome, { recursive: true })
    fs.writeFileSync(path.join(paths().claudeHome, '.credentials.json'), '{}')
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    return core
  }

  it('kills the container with the pane', async () => {
    const core = await startWithLog()
    const res = await sandboxed(core)
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    expect(removals()).toEqual(['rm -f ' + res.data.tmuxName])
  })

  it('removes the container with the session', async () => {
    const core = await startWithLog()
    const res = await sandboxed(core)
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionRemove({ id: res.data.id })
    expect(removals()).toEqual(['rm -f ' + res.data.tmuxName])
  })

  it('runs no container command at all for a session that was never sandboxed', async () => {
    const core = await startWithLog()
    const res = await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    expect(removals()).toEqual([])
  })

  it('prunes at start the grove containers no live session owns, and no others', async () => {
    t.fake.live.add('grove-live') // a tmux session still running, so its VM is not an orphan
    const core = await startWithLog(['grove-live', 'grove-orphan', 'someone-elses-box'])
    expect(core.getSlices().sessions).toEqual([])
    expect(containerCalls()).toContain('list --all --quiet')
    expect(removals()).toEqual(['rm -f grove-orphan'])
  })
})

// ADR 0033: a resumed sandboxed session stays sandboxed. Where this host cannot build the
// sandbox the resume downgrades rather than refusing — a pruned image must never lock the human
// out of their own session — but `sandboxed` goes false, so the record never claims containment
// the pane does not have, and the renderer reports the change once.
describe('sessionResume --sandboxed', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  const home = () => path.join(t.dir, 'home')
  const paths = () => ({
    claudeHome: path.join(home(), '.claude'),
    claudeJson: path.join(home(), '.claude.json'),
    gitconfig: path.join(home(), '.gitconfig'),
    spoolDir: path.join(t.dir, 'agents', 'claude'),
    socketPath: path.join(t.dir, 'grove.sock'),
    cliBundle: path.join(t.dir, 'out', 'main', 'cli.js'),
  })
  const dockerfile = () => path.join(t.dir, 'sandbox', 'Dockerfile')
  const container = () => path.join(t.dir, 'bin', 'container')

  async function start() {
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    fs.mkdirSync(paths().claudeHome, { recursive: true })
    fs.writeFileSync(path.join(paths().claudeHome, '.credentials.json'), '{}')
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    return core
  }

  // A sandboxed session, ended, ready to resume.
  async function ended(core: Awaited<ReturnType<typeof start>>) {
    const res = await core.commands.sessionCreate({ kind: 'claude', sandboxed: true, cwd: t.dir, cols: 120, rows: 40 })
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    return res.data.id
  }

  it('resumes inside its container, with the same mount set and the resume argv', async () => {
    const core = await start()
    const id = await ended(core)
    expect((await core.commands.sessionResume({ id })).ok).toBe(true)
    const argv = created(t.fake).at(-1)!.argv![4]
    expect(argv).toContain(`run --rm -i -t --name grove-${id}`)
    expect(argv).toContain(`--volume ${t.dir}:${t.dir}`)
    expect(argv).toContain(`--read-only-path ${paths().gitconfig}`)
    expect(argv).toMatch(new RegExp(`${imageRef(dockerfile())} claude -s \\S+$`))
    expect(core.getSlices().sessions.find((s) => s.id === id)?.sandboxed).toBe(true)
  })

  // ADR 0033's other half: a session that was sandboxed and no longer is must say so, because
  // `sandboxed: false` alone is indistinguishable from one that never had a sandbox. The note is
  // what makes the difference visible on the card and in the header.
  it('records what a downgrade lost, so the renderer can say the session is unguarded', async () => {
    const core = await start()
    const id = await ended(core)
    fs.rmSync(dockerfile()) // the image recipe is gone: nothing can be built from it
    const res = await core.commands.sessionResume({ id })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sandboxed).toBe(false)
    expect(res.data.sandboxNote).toBeTruthy()
    expect(core.getSlices().sessions.find((s) => s.id === id)?.sandboxNote).toBe(res.data.sandboxNote)
  })

  // A note that appeared for any other reason would misreport: it is the only signal that this
  // session lost containment rather than never having had it.
  it('leaves the note unset when nothing was lost', async () => {
    const core = await start()
    const sandboxed = await ended(core)
    expect((await core.commands.sessionResume({ id: sandboxed })).ok).toBe(true)
    expect(core.getSlices().sessions.find((s) => s.id === sandboxed)).not.toHaveProperty('sandboxNote')

    const plain = await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    if (!plain.ok) throw new Error(plain.error)
    await core.commands.sessionKill({ id: plain.data.id })
    expect((await core.commands.sessionResume({ id: plain.data.id })).ok).toBe(true)
    expect(core.getSlices().sessions.find((s) => s.id === plain.data.id)).not.toHaveProperty('sandboxNote')
  })

  // The note is a fact about this pane, not a property of the session. A restart drops it, and
  // what survives is the flag: the session stays unsandboxed, which is the part that must not lie.
  it('never saves the note, and the flag it qualifies stays false across a restart', async () => {
    const core = await start()
    const id = await ended(core)
    fs.rmSync(dockerfile())
    await core.commands.sessionResume({ id })
    const saved = loadState(t.statePath).sessions.find((s) => s.id === id)
    expect(saved).not.toHaveProperty('sandboxNote')
    expect(saved?.sandboxed).toBe(false)

    core.dispose()
    const restarted = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await restarted.start()
    expect(restarted.getSlices().sessions.find((s) => s.id === id)).toMatchObject({ sandboxed: false })
  })

  it('leaves an unsandboxed session on the host, exactly as it was', async () => {
    const core = await start()
    const res = await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    await core.commands.sessionResume({ id: res.data.id })
    expect(created(t.fake).at(-1)!.argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec claude -s \S+$/)
  })

  it('downgrades and clears the flag when no sandbox can be built, rather than refusing', async () => {
    const core = await start()
    const id = await ended(core)
    fs.rmSync(dockerfile()) // the image recipe is gone: nothing can be built from it
    const res = await core.commands.sessionResume({ id })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(created(t.fake).at(-1)!.argv![4]).toMatch(/^export PATH=\/bin:"\$PATH"; exec claude -s \S+$/)
    expect(res.data.sandboxed).toBe(false) // the flag is how the renderer learns to report it
  })

  it('costs no pane when it downgrades: the same conversation comes back running', async () => {
    const core = await start()
    const id = await ended(core)
    fs.rmSync(dockerfile())
    await core.commands.sessionResume({ id })
    const session = core.getSlices().sessions.find((s) => s.id === id)
    expect(session?.lastStatus).toBe('running')
    expect(session?.agentSessionId).not.toBeNull()
  })
})

// D8: grove probes the login-shell env rather than attempting a run, because a bare `-e VAR` for an
// absent variable does not fail the run (measured, exit 0) — so absence has to be seen from the
// host, or a sandboxed pane opens onto a login screen it cannot pass.
describe('sessionCreate --sandboxed probes the login shell for a credential', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  const home = () => path.join(t.dir, 'home')
  const paths = () => ({
    claudeHome: path.join(home(), '.claude'),
    claudeJson: path.join(home(), '.claude.json'),
    gitconfig: path.join(home(), '.gitconfig'),
    spoolDir: path.join(t.dir, 'agents', 'claude'),
    socketPath: path.join(t.dir, 'grove.sock'),
    cliBundle: path.join(t.dir, 'out', 'main', 'cli.js'),
  })

  // A login shell that carries exactly the named variable, and records that it was asked.
  function loginShell(set: string) {
    const dir = path.join(t.dir, 'shell')
    fs.mkdirSync(dir, { recursive: true })
    const asked = path.join(dir, 'asked')
    const script = path.join(dir, 'login-shell')
    fs.writeFileSync(
      script,
      `#!/bin/sh
name=\${4#'echo \${'}
name=\${name%':-}'}
echo "$name" >> ${JSON.stringify(asked)}
[ "$name" = ${JSON.stringify(set)} ] && printf 'set'
exit 0
`,
      { mode: 0o755 },
    )
    return { shell: script, asked: () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').trim().split('\n').filter(Boolean) : []) }
  }

  async function start(shell: string) {
    fs.mkdirSync(path.dirname(container()), { recursive: true })
    fs.writeFileSync(container(), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.mkdirSync(path.dirname(dockerfile()), { recursive: true })
    fs.writeFileSync(dockerfile(), 'FROM node:22-slim\n')
    vi.stubEnv('SHELL', shell)
    const core = t.make(undefined, {
      sessionEnv: { binDir: '/bin', ...paths() },
      sandbox: { container: container(), dockerfile: dockerfile() },
    })
    await core.start()
    return core
  }
  const container = () => path.join(t.dir, 'bin', 'container')
  const dockerfile = () => path.join(t.dir, 'sandbox', 'Dockerfile')
  const sandboxed = (core: Core) => core.commands.sessionCreate({ kind: 'claude', sandboxed: true, cwd: t.dir, cols: 120, rows: 40 })

  afterEach(() => { vi.unstubAllEnvs() })

  it('creates the session and names the variable it forwards when one is set', async () => {
    const { shell, asked } = loginShell('CLAUDE_CODE_OAUTH_TOKEN')
    const core = await start(shell)
    const res = await sandboxed(core)
    expect(res.ok).toBe(true)
    expect(asked()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN'])
    // the pointer at the config grove already mounts, and the token forwarded bare
    const argv = created(t.fake)[0].argv![4]
    expect(argv).toContain(`-e CLAUDE_CONFIG_DIR=${paths().claudeHome}`)
    expect(argv).toMatch(/-e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_API_KEY grove-sandbox:/)
    expect(argv).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=')
    expect(argv).toContain(`--read-only-path ${paths().claudeHome}/settings.json`)
    expect(argv).toContain(`--read-only-path ${paths().claudeHome}/.credentials.json`)
  })

  it('refuses no-sandbox and creates nothing when the login shell carries none', async () => {
    const { shell, asked } = loginShell('NEITHER')
    const core = await start(shell)
    expect(await sandboxed(core)).toEqual({ ok: false, error: 'no-sandbox-no-credential' })
    expect(created(t.fake)).toEqual([])
    expect(asked()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) // both probed, neither set
  })

  it('accepts a host ~/.claude/.credentials.json, which CLAUDE_CONFIG_DIR already reaches', async () => {
    fs.mkdirSync(paths().claudeHome, { recursive: true })
    fs.writeFileSync(path.join(paths().claudeHome, '.credentials.json'), '{}')
    const { shell } = loginShell('NEITHER')
    const core = await start(shell)
    expect((await sandboxed(core)).ok).toBe(true)
  })

  it('never probes for an unsandboxed claude session', async () => {
    const { shell, asked } = loginShell('NEITHER')
    const core = await start(shell)
    await core.commands.sessionCreate({ kind: 'claude', cwd: t.dir, cols: 120, rows: 40 })
    expect(asked()).toEqual([])
  })
})
