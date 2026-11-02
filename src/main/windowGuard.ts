import type { BrowserWindow } from 'electron'

// Only the main window's own origin may hold permissions, and only `media` (the planned voice input
// needs getUserMedia); artifact frames, other origins and every other permission are refused.
export const isOwnOrigin = (url: string, devUrl?: string): boolean => {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return true
    return devUrl !== undefined && devUrl !== '' && u.origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

export const permissionAllowed = (permission: string, url: string, devUrl?: string): boolean =>
  permission === 'media' && isOwnOrigin(url, devUrl)

export function guardWindow(win: BrowserWindow, devUrl?: string): void {
  const wc = win.webContents
  const ses = wc.session
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === wc && permissionAllowed(permission, details.requestingUrl, devUrl))
  })
  ses.setPermissionCheckHandler((contents, permission, origin) =>
    contents === wc && permissionAllowed(permission, origin, devUrl))
  wc.on('will-attach-webview', (e) => e.preventDefault())
}
