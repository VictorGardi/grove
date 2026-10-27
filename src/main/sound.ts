import type { Session } from '@shared/types'

// A system sound when a session starts waiting, played apart from the notification: unsigned
// builds can't show notifications (design D3), and a notification that fails plays no sound.
// macOS only (afplay). A burst of sessions waiting at once plays one sound.
export const SOUND_GAP_MS = 1000

const SOUNDS: Record<NonNullable<Session['waitingFor']>, string> = {
  permission: 'Glass', // needs the human: the sharper one
  question: 'Glass',
  done: 'Funk',
}

export function soundFile(waitingFor: Session['waitingFor']): string | null {
  return waitingFor ? `/System/Library/Sounds/${SOUNDS[waitingFor]}.aiff` : null
}

export function createSoundPlayer(play: (file: string) => void, now: () => number = Date.now): (s: Session) => void {
  let last = -Infinity
  return (s) => {
    const file = soundFile(s.waitingFor)
    if (!file || now() - last < SOUND_GAP_MS) return
    last = now()
    play(file)
  }
}
