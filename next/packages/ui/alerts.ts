import type { AttentionNotice, NeedsYouReason } from '../protocol/messages.ts'

// A system sound when a tab starts waiting or finishes, played apart from the notification: a notification
// that fails plays no sound. macOS only (afplay). A burst of tabs at once plays one sound.
export const SOUND_GAP_MS = 1000

const SOUNDS: Record<AttentionNotice['state'], string> = {
  'needs-you': 'Glass', // needs the human: the sharper one
  finished: 'Funk',
}

const BODY: Record<NeedsYouReason, string> = {
  permission: 'Needs permission',
  question: 'Has a question',
  error: 'Hit an error',
}

export function noticeBody(notice: AttentionNotice): string {
  if (notice.state === 'finished') return 'Finished'
  return notice.reason ? BODY[notice.reason] : 'Needs you'
}

export function soundFile(state: AttentionNotice['state']): string {
  return `/System/Library/Sounds/${SOUNDS[state]}.aiff`
}

// Returns the sound file to play for this notice, or null when it stays quiet (within the gap of the last sound).
export function createSoundGate(now: () => number = Date.now): (notice: AttentionNotice) => string | null {
  let last = -Infinity
  return (notice) => {
    if (now() - last < SOUND_GAP_MS) return null
    last = now()
    return soundFile(notice.state)
  }
}
