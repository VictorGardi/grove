import { describe, expect, it } from 'vitest'
import { languageToListenIn, readVoiceLanguage, writeVoiceLanguage, VOICE_LANGUAGE_KEY } from './voice-pref.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => void (data[key] = value), data }
}

describe('voice language preference', () => {
  it('is the Mac\'s language until the human picks one', () => {
    expect(readVoiceLanguage(memory())).toBe('system')
    expect(readVoiceLanguage(null)).toBe('system')
  })

  it('keeps a choice, and ignores a stored language the model does not know', () => {
    const store = memory()
    writeVoiceLanguage(store, 'sv')
    expect(store.data[VOICE_LANGUAGE_KEY]).toBe('sv')
    expect(readVoiceLanguage(store)).toBe('sv')
    expect(readVoiceLanguage(memory({ [VOICE_LANGUAGE_KEY]: 'xx' }))).toBe('system')
  })
})

describe('languageToListenIn', () => {
  it('uses the chosen language', () => {
    expect(languageToListenIn('de', 'sv-SE')).toBe('de')
  })

  it('takes the Mac\'s language when the choice is system', () => {
    expect(languageToListenIn('system', 'sv-SE')).toBe('sv')
    expect(languageToListenIn('system', 'en_US')).toBe('en')
    expect(languageToListenIn('system', 'nb-NO')).toBe('no')
  })

  it('lets the model tell the language when the Mac\'s is not one it is offered', () => {
    expect(languageToListenIn('system', 'xx-YY')).toBeNull()
    expect(languageToListenIn('system', '')).toBeNull()
  })
})
