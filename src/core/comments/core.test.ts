import { afterEach, describe, expect, it } from 'vitest'
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
