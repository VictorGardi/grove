import { persistedPref, type KeyValueStore } from './persisted-pref.ts'

// The language Voice input listens in, kept in the window's storage so a reload keeps it: a two-letter language code, or 'system'
// for the language of this Mac. 'system' until the human picks one.

export const VOICE_LANGUAGE_KEY = 'grove.voice-language'
export const SYSTEM_LANGUAGE = 'system'

// The languages Settings offers, which the speech model understands.
export const VOICE_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
]

const known = (code: string): boolean => VOICE_LANGUAGES.some((language) => language.code === code)

const voiceLanguage = persistedPref<string>({
  key: VOICE_LANGUAGE_KEY,
  fallback: () => SYSTEM_LANGUAGE,
  decode: (text) => (text === SYSTEM_LANGUAGE || known(text) ? text : undefined),
  encode: (value) => value,
})

export const readVoiceLanguage = (store: KeyValueStore | null): string => voiceLanguage.read(store)
export const writeVoiceLanguage = (store: KeyValueStore | null, value: string): void => voiceLanguage.write(store, value)

// The code to give the speech model: the chosen language, or this Mac's when that is one it knows, else null so the model tells the
// language from the voice.
export function languageToListenIn(choice: string, systemLocale: string): string | null {
  const code = choice === SYSTEM_LANGUAGE ? systemLocale.split(/[-_]/)[0]?.toLowerCase() ?? '' : choice
  // Norwegian Bokmål and Nynorsk are "no" to the speech model.
  const mapped = code === 'nb' || code === 'nn' ? 'no' : code
  return known(mapped) ? mapped : null
}
