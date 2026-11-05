import { describe, expect, it } from 'vitest'
import { GRACE_MS, type Status } from './contract.ts'
import { createCrossCheck, normaliseScreen } from './cross-check.ts'

const DIALOG = ['Bash command', '❯ 1. Yes', '  2. No', 'Do you want to run this?'].join('\n')

function setup() {
  let now = 0
  const check = createCrossCheck({ clock: () => now })
  const enter = (since: number): Status => {
    const status: Status = { state: 'needs-you', reason: 'permission', since }
    check.observe(status)
    return status
  }
  return { check, enter, setNow: (t: number) => (now = t) }
}

describe('normaliseScreen', () => {
  it('drops spinner glyphs, selection markers, blank lines and padding', () => {
    expect(normaliseScreen('  ⠋ Thinking…  \n\n❯ 1. Yes\n> 2. No')).toBe('Thinking…\n1. Yes\n2. No')
  })

  it('drops Claude’s spinner glyphs', () => {
    expect(normaliseScreen('✻ Thinking…\n✽ Thinking…\n✶ Thinking…\n✳ Thinking…\n✢ Thinking…\n· Thinking…')).toBe(
      'Thinking…\nThinking…\nThinking…\nThinking…\nThinking…\nThinking…',
    )
  })

  it('drops token counters, with or without k or m', () => {
    expect(normaliseScreen('Thinking… ↑ 1.2k tokens')).toBe('Thinking…')
    expect(normaliseScreen('Thinking… ↓ 340 tokens')).toBe('Thinking…')
    expect(normaliseScreen('Thinking… ↑ 2m tokens')).toBe('Thinking…')
  })

  it('still drops the selection marker and timers', () => {
    expect(normaliseScreen('❯ 1. Yes')).toBe('1. Yes')
    expect(normaliseScreen('Running 12s')).toBe('Running')
  })

  it('normalises two frames that differ only in spinner glyph or token counter to the same text', () => {
    const first = '✻ Thinking… (12s)\n↑ 1.2k tokens'
    const second = '✽ Thinking… (13s)\n↓ 1.3k tokens'
    expect(normaliseScreen(first)).toBe(normaliseScreen(second))
    expect(normaliseScreen('✶ Thinking…\n↑ 3k tokens')).toBe(normaliseScreen('· Thinking…\n↑ 340 tokens'))
  })

  it('keeps real text differences', () => {
    expect(normaliseScreen('✻ Thinking…\n↑ 1.2k tokens')).not.toBe(normaliseScreen('✻ Done.\n↑ 1.2k tokens'))
  })
})

describe('CrossCheck', () => {
  it('takes the first screen after a needs-you as the baseline, even inside the grace', () => {
    const t = setup()
    t.enter(0)
    t.setNow(1000)
    expect(t.check.check(DIALOG)).toBeNull()
    // A change inside the grace is compared, not lost: the comparison waits for the grace only.
    t.setNow(GRACE_MS - 1)
    expect(t.check.check('done')).toBeNull()
    t.setNow(GRACE_MS)
    expect(t.check.check('done')).toEqual({ state: 'unknown', since: GRACE_MS })
  })

  it('holds when the screen is identical after the grace', () => {
    const t = setup()
    t.enter(0)
    t.setNow(0)
    expect(t.check.check(DIALOG)).toBeNull()
    t.setNow(GRACE_MS)
    expect(t.check.check(DIALOG)).toBeNull()
    t.setNow(GRACE_MS + 1000)
    expect(t.check.check(DIALOG)).toBeNull()
    t.setNow(GRACE_MS + 2000)
    expect(t.check.check(DIALOG)).toBeNull()
  })

  it('falls to unknown when the dialog text changes after the grace', () => {
    const t = setup()
    t.enter(0)
    t.setNow(0)
    t.check.check(DIALOG)
    t.setNow(GRACE_MS)
    expect(t.check.check('❯ $ ls\n')).toEqual({ state: 'unknown', since: GRACE_MS })
  })

  it('ignores spinner changes and selection moves', () => {
    const t = setup()
    t.enter(0)
    t.setNow(0)
    t.check.check(DIALOG)
    t.setNow(GRACE_MS + 1000)
    expect(t.check.check(DIALOG.replace('❯ 1. Yes', '  1. Yes').replace('  2. No', '❯ 2. No') + '\n⠙')).toBeNull()
  })

  it('starts a new baseline for a new needs-you entry', () => {
    const t = setup()
    t.enter(0)
    t.setNow(0)
    t.check.check(DIALOG)
    t.setNow(GRACE_MS)
    expect(t.check.check('done')?.state).toBe('unknown')

    t.enter(10000)
    t.setNow(10000)
    expect(t.check.check('new dialog')).toBeNull()
    t.setNow(10000 + GRACE_MS)
    expect(t.check.check('new dialog')).toBeNull()
  })

  it('does nothing once the state is no longer needs-you', () => {
    const t = setup()
    t.enter(0)
    t.setNow(0)
    t.check.check(DIALOG)
    t.check.observe({ state: 'finished', since: 2000 })
    t.setNow(GRACE_MS + 5000)
    expect(t.check.check('changed')).toBeNull()
  })
})
