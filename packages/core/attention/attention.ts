import type { AttentionNotice, StatusChange } from '../../protocol/messages.ts'

export interface AttentionOptions {
  notify: (notice: AttentionNotice) => void
  markSeen: (tabId: string) => void
}

// Decides which status changes need the human's attention. A tab entering needs-you (any reason) or
// finished notifies once per entry; a tab on screen does not notify, and a finished one on screen is seen at once.
export class Attention {
  // The attention entry each tab last made, so one entry notifies once. Any other state clears it.
  private readonly entered = new Map<string, string>()
  private focusedTab: string | null = null
  private windowFocused = false

  constructor(private readonly options: AttentionOptions) {}

  focus(tabId: string | null, windowFocused: boolean): void {
    this.focusedTab = tabId
    this.windowFocused = windowFocused
    if (tabId !== null && windowFocused) this.options.markSeen(tabId)
  }

  onStatus(change: StatusChange): void {
    const notice = noticeOf(change)
    if (notice === undefined) {
      this.entered.delete(change.tabId)
      return
    }
    const key = `${notice.state}:${notice.reason ?? ''}`
    if (this.entered.get(change.tabId) === key) return
    this.entered.set(change.tabId, key)
    if (!this.onScreen(change.tabId)) {
      this.options.notify(notice)
    } else if (notice.state === 'finished') {
      this.options.markSeen(change.tabId)
    }
  }

  private onScreen(tabId: string): boolean {
    return this.windowFocused && tabId === this.focusedTab
  }
}

function noticeOf(change: StatusChange): AttentionNotice | undefined {
  if (change.state === 'needs-you' && change.reason !== undefined) {
    return { tabId: change.tabId, state: 'needs-you', reason: change.reason }
  }
  if (change.state === 'finished') return { tabId: change.tabId, state: 'finished' }
  return undefined
}
