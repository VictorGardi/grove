import { poll } from './usageSource.ts'

export { poll }

// The longest name a tab shows; a longer one is cut at a word where it can be.
export const NAME_MAX = 80

// A session name as one short line, or undefined when nothing is left: whitespace collapsed, control characters dropped,
// cut with an ellipsis past NAME_MAX.
export function cleanName(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (line === '') return undefined
  if (line.length <= NAME_MAX) return line
  const cut = line.slice(0, NAME_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > NAME_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// Delivers a name to `onName` unless it is the one delivered last. A throwing callback is logged and never retried.
export function nameReporter(agent: string, onName: (name: string) => void): (name: string | undefined) => void {
  let last: string | undefined
  return (name) => {
    if (name === undefined || name === last) return
    last = name
    try {
      onName(name)
    } catch (error) {
      console.error(`core: could not report the ${agent} session name: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// Names change rarely, so they are read less often than a context reading.
export const NAME_POLL_MS = 3000
