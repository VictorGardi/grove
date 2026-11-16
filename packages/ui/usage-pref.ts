import { persistedPref, type KeyValueStore } from './persisted-pref.ts'
import { DEFAULT_RANGE, type RangeId } from './usage-model.ts'

// The usage panel's range and its second breakdown, kept in the window's storage so a reload keeps them.

export const USAGE_RANGE_KEY = 'grove.usage-range'
export const USAGE_BREAKDOWN_KEY = 'grove.usage-breakdown'
export type Breakdown = 'repositories' | 'models'

const RANGE_IDS: readonly string[] = ['30d', '18w', '1y'] satisfies RangeId[]

const range = persistedPref<RangeId>({
  key: USAGE_RANGE_KEY,
  fallback: () => DEFAULT_RANGE,
  decode: (text) => (RANGE_IDS.includes(text) ? (text as RangeId) : undefined),
  encode: (value) => value,
})
const breakdown = persistedPref<Breakdown>({
  key: USAGE_BREAKDOWN_KEY,
  fallback: () => 'repositories',
  decode: (text) => (text === 'repositories' || text === 'models' ? text : undefined),
  encode: (value) => value,
})

export const readUsageRange = (store: KeyValueStore | null): RangeId => range.read(store)
export const writeUsageRange = (store: KeyValueStore | null, value: RangeId): void => range.write(store, value)
export const readUsageBreakdown = (store: KeyValueStore | null): Breakdown => breakdown.read(store)
export const writeUsageBreakdown = (store: KeyValueStore | null, value: Breakdown): void => breakdown.write(store, value)
