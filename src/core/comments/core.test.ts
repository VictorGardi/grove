import { afterEach, describe, expect, it } from 'vitest'
import { createTerminal as create, setupCore } from '../testing/setup'

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
})
