import { describe, expect, it } from 'vitest'
import { SILENCE_MS, type Status } from './contract.ts'
import { createWatchdog } from './watchdog.ts'

function setup() {
  let now = 0
  const watchdog = createWatchdog({ clock: () => now })
  return { watchdog, setNow: (t: number) => (now = t) }
}

const working = (since: number): Status => ({ state: 'working', since })

describe('Watchdog', () => {
  it('falls to unknown after the silence threshold and not before', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    t.watchdog.progress(0)
    t.setNow(SILENCE_MS - 1)
    expect(t.watchdog.check()).toBeNull()
    t.setNow(SILENCE_MS)
    expect(t.watchdog.check()).toEqual({ state: 'unknown', since: SILENCE_MS })
  })

  it('resets the timer on each reader heartbeat', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    t.setNow(20000)
    t.watchdog.progress()
    t.setNow(20000 + SILENCE_MS - 1)
    expect(t.watchdog.check()).toBeNull()
    t.setNow(20000 + SILENCE_MS)
    expect(t.watchdog.check()?.state).toBe('unknown')
  })

  it('takes heartbeat time from an explicit argument', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    t.watchdog.progress(25000)
    t.setNow(25000 + SILENCE_MS - 1)
    expect(t.watchdog.check()).toBeNull()
  })

  it('does not fire once unknown, and fires again for the next state after a silence', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    t.watchdog.progress(0)
    t.setNow(SILENCE_MS)
    t.watchdog.check()
    t.watchdog.observe({ state: 'unknown', since: SILENCE_MS })
    t.setNow(SILENCE_MS * 3)
    expect(t.watchdog.check()).toBeNull()

    t.watchdog.observe(working(SILENCE_MS * 3))
    t.watchdog.progress(SILENCE_MS * 3)
    t.setNow(SILENCE_MS * 4 - 1)
    expect(t.watchdog.check()).toBeNull()
    t.setNow(SILENCE_MS * 4)
    expect(t.watchdog.check()?.state).toBe('unknown')
  })

  it('a working tab ignores heartbeats: only progress keeps it', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    t.watchdog.progress(0)
    for (let at = 1000; at < SILENCE_MS; at += 1000) {
      t.setNow(at)
      t.watchdog.heartbeat()
    }
    t.setNow(SILENCE_MS)
    expect(t.watchdog.check()).toEqual({ state: 'unknown', since: SILENCE_MS })
  })

  it('a working tab stays working while progress keeps coming, however long the reader has been running', () => {
    const t = setup()
    t.watchdog.observe(working(0))
    for (let at = 0; at <= SILENCE_MS * 5; at += 1000) {
      t.setNow(at)
      t.watchdog.progress()
      if (at % 10000 === 0) t.watchdog.progress()
      expect(t.watchdog.check()).toBeNull()
    }
  })

  it('a needs-you tab is not affected by progress, only by heartbeats', () => {
    const t = setup()
    t.watchdog.observe({ state: 'needs-you', reason: 'question', since: 0 })
    t.watchdog.progress(0)
    t.setNow(SILENCE_MS)
    expect(t.watchdog.check()?.state).toBe('unknown')
  })

  it('falls to unknown from needs-you, idle and finished too, once the reader is silent', () => {
    const states: Status[] = [
      { state: 'needs-you', reason: 'question', since: 0 },
      { state: 'idle', since: 0 },
      { state: 'finished', since: 0 },
    ]
    for (const status of states) {
      const t = setup()
      t.watchdog.observe(status)
      t.watchdog.heartbeat(0)
      t.setNow(SILENCE_MS)
      expect(t.watchdog.check()).toEqual({ state: 'unknown', since: SILENCE_MS })
    }
  })

  it('keeps a quiet needs-you while the reader keeps heartbeating', () => {
    const t = setup()
    t.watchdog.observe({ state: 'needs-you', reason: 'question', since: 0 })
    for (let at = 0; at <= SILENCE_MS * 10; at += 1000) {
      t.setNow(at)
      t.watchdog.heartbeat()
      expect(t.watchdog.check()).toBeNull()
    }
  })
})
