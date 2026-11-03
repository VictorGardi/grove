import type { BrowserWindow } from 'electron'

// Only the main window's own origin may hold permissions, and only `media` (voice input needs
// getUserMedia) and `clipboard-sanitized-write` (the terminal's copy via navigator.clipboard.writeText);
// artifact frames, other origins and every other permission are refused.
export const isOwnOrigin = (url: string, devUrl?: string): boolean => {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return true
    return devUrl !== undefined && devUrl !== '' && u.origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

export const permissionAllowed = (permission: string, url: string, devUrl?: string, mediaTypes?: string[]): boolean =>
  isOwnOrigin(url, devUrl) &&
  (permission === 'clipboard-sanitized-write' ||
    (permission === 'media' && (mediaTypes === undefined || mediaTypes.every((t) => t === 'audio'))))

export function guardWindow(win: BrowserWindow, devUrl?: string): void {
  const wc = win.webContents
  const ses = wc.session
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    callback(contents === wc && details.isMainFrame !== false && permissionAllowed(permission, details.requestingUrl, devUrl, mediaTypes))
  })
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === wc && details?.isMainFrame !== false && permissionAllowed(permission, details?.requestingUrl ?? origin, devUrl))
  wc.on('will-attach-webview', (e) => e.preventDefault())
}
