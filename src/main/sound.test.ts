import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { createSoundPlayer, SOUND_GAP_MS, soundFile } from './sound'

const waiting = (waitingFor: Session['waitingFor']) => ({ id: 'a', waitingFor }) as Session

describe('sound', () => {
  it('picks a sharper sound for the human than for a finished session', () => {
    expect(soundFile('permission')).toBe('/System/Library/Sounds/Glass.aiff')
    expect(soundFile('question')).toBe('/System/Library/Sounds/Glass.aiff')
    expect(soundFile('done')).toBe('/System/Library/Sounds/Funk.aiff')
    expect(soundFile(undefined)).toBeNull()
  })

  it('plays one sound for a burst, and again after the gap', () => {
    let t = 0
    const played: string[] = []
    const play = createSoundPlayer((f) => played.push(f), () => t)
    play(waiting('done'))
    t = SOUND_GAP_MS - 1
    play(waiting('permission'))
    t = SOUND_GAP_MS
    play(waiting('permission'))
    expect(played).toEqual(['/System/Library/Sounds/Funk.aiff', '/System/Library/Sounds/Glass.aiff'])
  })

  it('stays quiet for a session with no waiting reason', () => {
    const played: string[] = []
    createSoundPlayer((f) => played.push(f), () => 0)(waiting(undefined))
    expect(played).toEqual([])
  })
})
