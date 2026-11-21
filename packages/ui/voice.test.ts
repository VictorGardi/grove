import { describe, expect, it } from 'vitest'
import { createVoice, DIDNT_CATCH, MAX_HOLD_MS, MIN_HOLD_MS, pasteable, voiceTarget, type Recorder, type StartResult, type StopResult, type VoiceDeps, type VoiceTab } from './voice.ts'

const agentTab: VoiceTab = { id: 't1', kind: 'claude', exited: false }

function setup(over: { target?: VoiceTab | null; start?: StartResult; stop?: StopResult; offer?: boolean } = {}) {
  const log: string[] = []
  const written: Array<[string, string]> = []
  const notices: string[] = []
  const timers: Array<{ run: () => void; ms: number; live: boolean }> = []
  let clock = 0
  let tabs: Record<string, VoiceTab | null> = { t1: agentTab }
  const recorder: Recorder = {
    start: async () => {
      log.push('start')
      return over.start ?? { ok: true }
    },
    stop: async (language) => {
      log.push(`stop:${language}`)
      return over.stop ?? { ok: true, text: ' hello  world\n' }
    },
    cancel: async () => void log.push('cancel'),
  }
  const deps: VoiceDeps = {
    recorder,
    target: () => (over.target === undefined ? agentTab : over.target),
    tab: (id) => tabs[id] ?? null,
    write: async (id, data) => void written.push([id, data]),
    language: () => 'sv',
    phase: (id, phase) => void log.push(`phase:${id}:${phase}`),
    notice: (text) => void notices.push(text),
    offerDownload: async () => {
      log.push('offer')
      return over.offer ?? false
    },
    setTimer: (run, ms) => timers.push({ run, ms, live: true }) - 1,
    clearTimer: (handle) => {
      timers[handle as number]!.live = false
    },
    now: () => clock,
  }
  const voice = createVoice(deps)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { voice, log, written, notices, timers, settle, advance: (ms: number) => void (clock += ms), setTabs: (next: Record<string, VoiceTab | null>) => void (tabs = next) }
}

describe('voiceTarget', () => {
  it('is an agent tab that has not exited', () => {
    expect(voiceTarget(agentTab)).toBe(agentTab)
    expect(voiceTarget({ id: 's', kind: 'shell', exited: false })).toBeNull()
    expect(voiceTarget({ ...agentTab, exited: true })).toBeNull()
    expect(voiceTarget(null)).toBeNull()
  })
})

describe('pasteable', () => {
  it('is one trimmed line', () => {
    expect(pasteable(' hello  world\n again ')).toBe('hello world again')
  })
})

describe('hold to talk', () => {
  it('takes the key in an agent tab, and leaves it to the terminal in a shell tab or with no tab', () => {
    expect(setup().voice.press()).toBe(true)
    expect(setup({ target: { id: 's', kind: 'shell', exited: false } }).voice.press()).toBe(false)
    expect(setup({ target: null }).voice.press()).toBe(false)
    expect(setup({ target: { ...agentTab, exited: true } }).voice.press()).toBe(false)
  })

  it('pastes what was said after the key comes up, as a bracketed paste with no Enter', async () => {
    const t = setup()
    t.voice.press()
    t.advance(MIN_HOLD_MS + 1)
    t.voice.release()
    await t.settle()
    expect(t.written).toEqual([['t1', '\x1b[200~hello world\x1b[201~']])
    expect(t.log).toEqual(['start', 'phase:t1:listening', 'phase:t1:transcribing', 'stop:sv', 'phase:t1:null'])
    expect(t.notices).toEqual([])
  })

  it('does nothing for a stray tap', async () => {
    const t = setup()
    t.voice.press()
    t.advance(MIN_HOLD_MS - 1)
    t.voice.release()
    await t.settle()
    expect(t.written).toEqual([])
    expect(t.log).toContain('cancel')
    expect(t.log).not.toContain('stop:sv')
    expect(t.notices).toEqual([])
  })

  it('says it did not catch that, and pastes nothing', async () => {
    const t = setup({ stop: { ok: true, text: '  ' } })
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.written).toEqual([])
    expect(t.notices).toEqual([DIDNT_CATCH])
  })

  it('treats key repeat as the same hold', async () => {
    const t = setup()
    t.voice.press()
    t.voice.press()
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.log.filter((entry) => entry === 'start')).toHaveLength(1)
    expect(t.written).toHaveLength(1)
  })

  it('ignores a release with no hold, and a second release', async () => {
    const t = setup()
    t.voice.release()
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    t.voice.release()
    await t.settle()
    expect(t.log.filter((entry) => entry.startsWith('stop'))).toHaveLength(1)
  })

  it('sends the words to the tab the hold started in, even when another is active by then', async () => {
    const t = setup()
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.written[0]?.[0]).toBe('t1')
  })

  it('drops the words when that tab is gone, and says so', async () => {
    const t = setup()
    t.voice.press()
    t.advance(1000)
    t.setTabs({})
    t.voice.release()
    await t.settle()
    expect(t.written).toEqual([])
    expect(t.notices).toHaveLength(1)
  })

  it('stops at the longest hold as if the key had come up', async () => {
    const t = setup()
    t.voice.press()
    expect(t.timers[0]?.ms).toBe(MAX_HOLD_MS)
    t.advance(MAX_HOLD_MS)
    t.timers[0]!.run()
    await t.settle()
    expect(t.written).toHaveLength(1)
    expect(t.voice.holding()).toBe(false)
  })

  it('pastes while the agent is waiting on the human, as the human chose', async () => {
    const t = setup()
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.written).toHaveLength(1)
  })

  it('names the microphone setting when access is denied', async () => {
    const t = setup({ start: { ok: false, reason: 'mic-denied' } })
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.written).toEqual([])
    expect(t.notices[0]).toContain('Microphone')
  })

  it('offers the model download when the model is missing, and says nothing more once the human said yes', async () => {
    const yes = setup({ start: { ok: false, reason: 'no-model' }, offer: true })
    yes.voice.press()
    yes.advance(1000)
    yes.voice.release()
    await yes.settle()
    expect(yes.log).toContain('offer')
    expect(yes.notices).toEqual([])
    const no = setup({ start: { ok: false, reason: 'no-model' }, offer: false })
    no.voice.press()
    no.advance(1000)
    no.voice.release()
    await no.settle()
    expect(no.notices).toHaveLength(1)
  })

  it('reports a recorder that throws', async () => {
    const t = setup({ stop: { ok: false, message: 'boom' } })
    t.voice.press()
    t.advance(1000)
    t.voice.release()
    await t.settle()
    expect(t.notices).toEqual(['boom'])
  })
})
