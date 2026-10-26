import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { saveConfig } from '../store/configStore'
import { createClaude, createTerminal as create, setupCore } from '../testing/setup'

describe('core review comments', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  async function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    await core.start()
    return { ...s, core, session: await create(core) }
  }

  it('sends the note once and marks it sent', async () => {
    const { core, session, fake } = await setup()
    const added = await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'reply pong' })
    expect(added.ok).toBe(true)
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: true, data: { sent: 1 } })
    expect(fake.pastes).toEqual([{
      name: session.tmuxName, submit: true,
      text: 'Review comments from Grove (1). Please address each one.\n\nreply pong',
    }])
    expect(core.getSlices().comments).toMatchObject([{ state: 'sent', body: 'reply pong' }])
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'empty' })
  })

  it('keeps the drafts when the send fails', async () => {
    const { core, session, fake } = await setup()
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'x' })
    fake.paste = async () => { throw new Error('boom') }
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'boom' })
    expect(core.getSlices().comments[0].state).toBe('draft')
  })

  it('refuses a second send while one is in flight', async () => {
    const { core, session, fake } = await setup()
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'x' })
    let release = () => {}
    fake.paste = () => new Promise<void>((r) => { release = r })
    const first = core.commands.reviewSend({ sessionId: session.id })
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'busy' })
    release()
    expect((await first).ok).toBe(true)
  })

  it('edits and deletes drafts, and refuses an unknown session', async () => {
    const { core, session } = await setup()
    expect(await core.commands.commentAdd({ sessionId: 'nope', anchor: { kind: 'note' }, body: 'x' })).toEqual({ ok: false, error: 'not-found' })
    const added = await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'x' })
    if (!added.ok) throw new Error(added.error)
    await core.commands.commentUpdate({ id: added.data.id, body: 'y' })
    expect(core.getSlices().comments[0].body).toBe('y')
    await core.commands.commentDelete({ id: added.data.id })
    expect(core.getSlices().comments).toEqual([])
  })

  it('persists comments across restarts and drops them with the session', async () => {
    const { core, session, make, fake } = await setup()
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'keep' })
    const again = make()
    await again.start()
    expect(again.getSlices().comments).toMatchObject([{ body: 'keep' }])
    fake.live.clear()
    await again.checkLiveness()
    await again.commands.sessionRemove({ id: session.id })
    expect(again.getSlices().comments).toEqual([])
    const third = make()
    await third.start()
    expect(third.getSlices().comments).toEqual([])
  })

  it('resumes a gone agent session before sending', async () => {
    const s = setupCore()
    disposeAll = s.disposeAll
    const core = s.make()
    await core.start()
    const session = await createClaude(core)
    s.fake.live.clear()
    await core.checkLiveness()
    expect(core.getSlices().sessions[0].lastStatus).toBe('gone')
    s.fake.captured.set(session.tmuxName, 'prompt >')
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'hello again' })
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: true, data: { sent: 1 } })
    expect(core.getSlices().sessions[0].lastStatus).toBe('running')
    expect(s.fake.pastes).toHaveLength(1)
    expect(core.getSlices().comments[0].state).toBe('sent')
  }, 15000)

  it('names the checkout each draft came from, so one message can carry two of one path', async () => {
    // A checkout and a worktree of it, exactly as core registers them. The viewer is global while
    // the draft attaches to the focused session (ArtifactViewer.tsx:37), so both checkouts' copies
    // of one relative path can end up in one session's tray — and must not merge into one heading.
    const s = setupCore()
    disposeAll = s.disposeAll
    // the worktree's directory must exist: a worktree project whose path is gone is pruned at start
    fs.mkdirSync(path.join(s.dir, 'wt'))
    saveConfig(s.configPath, {
      schemaVersion: 1,
      projects: [
        { id: 'p', name: 'grove', path: s.dir },
        { id: 'wt', name: 'grove · fix-auth', path: path.join(s.dir, 'wt'), worktreeOf: 'p' },
      ],
    })
    const core = s.make()
    await core.start()
    const session = await create(core, 'p')
    const anchor = (projectId: string) => ({ kind: 'file' as const, projectId, path: 'docs/work/x/03-design.md', exact: 'q', prefix: '', suffix: '', start: 1, end: 1 })
    await core.commands.commentAdd({ sessionId: session.id, anchor: anchor('p'), body: 'in the checkout' })
    await core.commands.commentAdd({ sessionId: session.id, anchor: anchor('wt'), body: 'in the worktree' })

    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: true, data: { sent: 2 } })
    expect(s.fake.pastes[0].text).toBe([
      'Review comments from Grove (2). Please address each one.',
      '',
      '## docs/work/x/03-design.md (grove)',
      'L1, on "q":',
      'in the checkout',
      '',
      '## docs/work/x/03-design.md (grove · fix-auth)',
      'L1, on "q":',
      'in the worktree',
    ].join('\n'))
  })
})

describe('core drafts kept on a feature', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())
  const F = { projectId: 'p', slug: 'a' }
  const anchor = { kind: 'file' as const, projectId: 'p', path: 'docs/work/a/03-design.md', exact: 'q', prefix: '', suffix: '', start: 1, end: 1 }
  const feature = (dir: string, slug: string) => {
    fs.mkdirSync(path.join(dir, 'docs', 'work', slug), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'work', slug, 'feature.md'), `---\nkind: feature\n---\n# ${slug}\n`)
  }

  async function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    feature(s.dir, 'a')
    const core = s.make()
    await core.start()
    await vi.waitFor(() => expect(core.getSlices().features.items.map((f) => f.slug)).toContain('a'))
    return { ...s, core }
  }

  it('adds, edits and deletes one with no session at all, and keeps it across restarts', async () => {
    const { core, make } = await setup()
    expect(core.getSlices().sessions).toEqual([])
    const added = await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    if (!added.ok) throw new Error(added.error)
    expect(added.data).toMatchObject({ sessionId: null, feature: F, state: 'draft' })
    await core.commands.commentUpdate({ id: added.data.id, body: 'edited' })
    const again = make()
    await again.start()
    expect(again.getSlices().comments).toMatchObject([{ sessionId: null, feature: F, body: 'edited' }])
    expect(await again.commands.commentDelete({ id: added.data.id })).toEqual({ ok: true, data: { id: added.data.id } })
    expect(again.getSlices().comments).toEqual([])
  })

  it('refuses a note or diff anchor, a file in another project, and an unknown feature', async () => {
    const { core } = await setup()
    expect(await core.commands.commentAdd({ sessionId: null, feature: F, anchor: { kind: 'note' }, body: 'x' })).toEqual({ ok: false, error: 'bad-owner' })
    const diff = { kind: 'diff' as const, root: '/r', path: 'a', side: 'new' as const, start: 1, end: 1, lines: ['x'] }
    expect(await core.commands.commentAdd({ sessionId: null, feature: F, anchor: diff, body: 'x' })).toEqual({ ok: false, error: 'bad-owner' })
    expect(await core.commands.commentAdd({ sessionId: null, feature: F, anchor: { ...anchor, projectId: 'q' }, body: 'x' })).toEqual({ ok: false, error: 'bad-owner' })
    expect(await core.commands.commentAdd({ sessionId: null, feature: { projectId: 'p', slug: 'nope' }, anchor, body: 'x' })).toEqual({ ok: false, error: 'not-found' })
    expect(await core.commands.commentAdd({ sessionId: null, feature: { projectId: 'zz', slug: 'a' }, anchor, body: 'x' })).toEqual({ ok: false, error: 'not-found' })
    expect(await core.commands.commentAdd({ sessionId: null, anchor, body: 'x' })).toEqual({ ok: false, error: 'not-found' })
    expect(core.getSlices().comments).toEqual([])
  })

  it('outlives a session that is not linked to its feature', async () => {
    const { core, fake } = await setup()
    const session = await create(core)
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'empty' })
    fake.live.clear()
    await core.checkLiveness()
    await core.commands.sessionRemove({ id: session.id })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, body: 'kept', state: 'draft' }])
  })

  it('is sent by a session linked to its feature and re-owned to it', async () => {
    const { core, fake } = await setup()
    const session = await create(core)
    await core.commands.sessionLink({ id: session.id, feature: 'a' })
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'mine' })
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: true, data: { sent: 2 } })
    expect(fake.pastes[0].text).toContain('kept')
    expect(fake.pastes[0].text).toContain('mine')
    const cs = core.getSlices().comments
    expect(cs.map((c) => [c.body, c.state, c.sessionId])).toEqual([['kept', 'sent', session.id], ['mine', 'sent', session.id]])
    expect('feature' in cs[0]).toBe(false)
  })

  it('is sent to an unlinked session the full page picks, with its own drafts, and re-owned to it', async () => {
    const { core, fake } = await setup()
    const session = await create(core)
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    await core.commands.commentAdd({ sessionId: session.id, anchor: { kind: 'note' }, body: 'mine' })
    expect(await core.commands.reviewSend({ sessionId: session.id, feature: F })).toEqual({ ok: true, data: { sent: 2 } })
    expect(fake.pastes[0].text).toContain('kept')
    expect(core.getSlices().comments.map((c) => [c.body, c.state, c.sessionId])).toEqual([['kept', 'sent', session.id], ['mine', 'sent', session.id]])
    expect(core.getSlices().sessions[0].feature ?? null).toBeNull() // sending does not link it
  })

  it('stays kept on its feature when the send fails or is busy', async () => {
    const { core, fake } = await setup()
    const session = await create(core)
    await core.commands.sessionLink({ id: session.id, feature: 'a' })
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    fake.paste = async () => { throw new Error('boom') }
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'boom' })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, feature: F, state: 'draft' }])
    let release = () => {}
    fake.paste = () => new Promise<void>((r) => { release = r })
    const first = core.commands.reviewSend({ sessionId: session.id })
    expect(await core.commands.reviewSend({ sessionId: session.id })).toEqual({ ok: false, error: 'busy' })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, feature: F, state: 'draft' }])
    release()
    expect((await first).ok).toBe(true)
  })

  it('is not sent to a second session while a send of it to another is in flight', async () => {
    const { core, fake } = await setup()
    const a = await create(core)
    const b = await create(core)
    await core.commands.sessionLink({ id: a.id, feature: 'a' })
    await core.commands.sessionLink({ id: b.id, feature: 'a' })
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    let release = () => {}
    fake.paste = () => new Promise<void>((r) => { release = r })
    const first = core.commands.reviewSend({ sessionId: a.id })
    expect(await core.commands.reviewSend({ sessionId: b.id })).toEqual({ ok: false, error: 'busy' })
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'busy' })
    release()
    expect(await first).toEqual({ ok: true, data: { sent: 1 } })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: a.id, state: 'sent' }])
    expect(core.getSlices().sessions.filter((x) => x.kind === 'claude')).toEqual([])
  })

  it('starts a session on its feature with the drafts as its launch prompt', async () => {
    const { core, fake } = await setup()
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    const r = await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.sent).toBe(1)
    const session = core.getSlices().sessions.find((x) => x.id === r.data.sessionId)
    expect(session).toMatchObject({ projectId: 'p', feature: 'a', kind: 'claude' })
    const create = fake.calls.find((c) => c.method === 'create')!.args[0] as { argv: string[] }
    expect(create.argv.join(' ')).toContain('Review comments from Grove (1).')
    expect(create.argv.join(' ')).toContain('kept')
    expect(fake.pastes).toEqual([])
    const cs = core.getSlices().comments
    expect(cs).toMatchObject([{ sessionId: r.data.sessionId, state: 'sent', body: 'kept' }])
    expect('feature' in cs[0]).toBe(false)
  })

  it('refuses a second start for the same feature while the first is in flight', async () => {
    const { core, fake } = await setup()
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    let release = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const real = fake.create.bind(fake)
    fake.create = async (o) => { await gate; return real(o) }
    const first = core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'busy' })
    release()
    const r = await first
    if (!r.ok) throw new Error(r.error)
    expect(core.getSlices().sessions).toHaveLength(1)
    expect(core.getSlices().comments).toMatchObject([{ sessionId: r.data.sessionId, state: 'sent' }])
  })

  it('keeps the drafts on the feature when the start fails', async () => {
    const { core, claude, fake } = await setup()
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    claude.missing = 'no claude'
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'no claude' })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, feature: F, state: 'draft' }])
    claude.missing = null
    fake.create = async () => { throw new Error('tmux down') }
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'tmux down' })
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, feature: F, state: 'draft' }])
  })

  it('refuses a terminal, an unknown feature and a feature with no drafts', async () => {
    const { core } = await setup()
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'empty' })
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'kept' })
    expect(await core.commands.reviewStartAndSend({ feature: F, kind: 'terminal', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'bad-kind' })
    expect(await core.commands.reviewStartAndSend({ feature: { projectId: 'p', slug: 'nope' }, kind: 'claude', cols: 80, rows: 24 })).toEqual({ ok: false, error: 'not-found' })
    expect(core.getSlices().sessions).toEqual([])
    expect(core.getSlices().comments).toMatchObject([{ sessionId: null, state: 'draft' }])
  })

  it('goes with its project when the project is removed', async () => {
    const s = setupCore()
    disposeAll = s.disposeAll
    const other = path.join(s.dir, 'other')
    feature(s.dir, 'a')
    feature(other, 'a')
    saveConfig(s.configPath, { schemaVersion: 1, projects: [{ id: 'p', name: 'proj', path: s.dir }, { id: 'q', name: 'other', path: other }] })
    const core = s.make()
    await core.start()
    await vi.waitFor(() => expect(core.getSlices().features.items.map((f) => f.projectId).sort()).toEqual(['p', 'q']))
    await core.commands.commentAdd({ sessionId: null, feature: F, anchor, body: 'in p' })
    await core.commands.commentAdd({ sessionId: null, feature: { projectId: 'q', slug: 'a' }, anchor: { ...anchor, projectId: 'q' }, body: 'in q' })
    expect((await core.commands.projectRemove({ id: 'q' })).ok).toBe(true)
    expect(core.getSlices().comments.map((c) => c.body)).toEqual(['in p'])
  })
})
