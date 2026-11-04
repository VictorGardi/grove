import { describe, expect, it } from 'vitest'
import type { AttentionNotice } from '../protocol/messages.ts'
import { createSoundGate, noticeBody, SOUND_GAP_MS, soundFile } from './alerts.ts'

const needsYou = (reason: AttentionNotice['reason']): AttentionNotice => ({ tabId: 'a', state: 'needs-you', reason })
const finished: AttentionNotice = { tabId: 'a', state: 'finished' }

describe('sound', () => {
  it('picks a sharper sound for the human than for a finished tab', () => {
    expect(soundFile('needs-you')).toBe('/System/Library/Sounds/Glass.aiff')
    expect(soundFile('finished')).toBe('/System/Library/Sounds/Funk.aiff')
  })

  it('plays one sound for a burst, and again after the gap', () => {
    let t = 0
    const gate = createSoundGate(() => t)
    const played: Array<string | null> = []
    played.push(gate(finished))
    t = SOUND_GAP_MS - 1
    played.push(gate(needsYou('permission')))
    t = SOUND_GAP_MS
    played.push(gate(needsYou('permission')))
    expect(played).toEqual(['/System/Library/Sounds/Funk.aiff', null, '/System/Library/Sounds/Glass.aiff'])
  })

  it('keeps the gap from the last sound that played, not from a quiet one', () => {
    let t = 0
    const gate = createSoundGate(() => t)
    expect(gate(finished)).toBe('/System/Library/Sounds/Funk.aiff')
    t = 600
    expect(gate(finished)).toBeNull()
    t = 1000
    expect(gate(needsYou('error'))).toBe('/System/Library/Sounds/Glass.aiff')
  })

  it('plays for the first notice of any kind, however early it arrives', () => {
    const gate = createSoundGate(() => 0)
    expect(gate(needsYou('question'))).toBe('/System/Library/Sounds/Glass.aiff')
  })
})

describe('noticeBody', () => {
  it('names the reason a tab needs the human', () => {
    expect(noticeBody(needsYou('permission'))).toBe('Needs permission')
    expect(noticeBody(needsYou('question'))).toBe('Has a question')
    expect(noticeBody(needsYou('error'))).toBe('Hit an error')
  })

  it('falls back to a generic line when a needs-you notice has no reason', () => {
    expect(noticeBody(needsYou(undefined))).toBe('Needs you')
  })

  it('says finished for a finished tab', () => {
    expect(noticeBody(finished)).toBe('Finished')
  })
})
