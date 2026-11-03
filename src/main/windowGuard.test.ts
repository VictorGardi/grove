import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { guardWindow, permissionAllowed } from './windowGuard'

describe('permissionAllowed', () => {
  it('allows media for the packaged and dev origins only', () => {
    expect(permissionAllowed('media', 'file:///app/out/renderer/index.html')).toBe(true)
    expect(permissionAllowed('media', 'http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
    expect(permissionAllowed('media', 'http://localhost:9999/', 'http://localhost:5173/')).toBe(false)
    expect(permissionAllowed('media', 'grove-artifact://p/a.html')).toBe(false)
    expect(permissionAllowed('media', 'https://example.com/')).toBe(false)
    expect(permissionAllowed('media', 'not a url')).toBe(false)
  })

  it('denies every other permission', () => {
    expect(permissionAllowed('geolocation', 'file:///app/index.html')).toBe(false)
    expect(permissionAllowed('notifications', 'file:///app/index.html')).toBe(false)
    expect(permissionAllowed('clipboard-read', 'file:///app/index.html')).toBe(false)
  })

  it('allows the terminal to write the clipboard from the main window only', () => {
    expect(permissionAllowed('clipboard-sanitized-write', 'file:///app/index.html')).toBe(true)
    expect(permissionAllowed('clipboard-sanitized-write', 'grove-artifact://p/a.html')).toBe(false)
  })
})

describe('guardWindow', () => {
  const setup = () => {
    let request!: (c: unknown, p: string, cb: (ok: boolean) => void, d: { requestingUrl: string }) => void
    let check!: (c: unknown, p: string, origin: string, d?: { requestingUrl?: string; isMainFrame?: boolean }) => boolean
    let attach!: (e: { preventDefault: () => void }) => void
    const wc = {
      session: {
        setPermissionRequestHandler: (fn: typeof request) => { request = fn },
        setPermissionCheckHandler: (fn: typeof check) => { check = fn },
      },
      on: (event: string, fn: typeof attach) => { if (event === 'will-attach-webview') attach = fn },
    }
    guardWindow({ webContents: wc } as unknown as BrowserWindow)
    return { wc, request, check, attach }
  }

  it('grants media to the main window and refuses another permission', () => {
    const { wc, request, check } = setup()
    const cb = vi.fn()
    request(wc, 'media', cb, { requestingUrl: 'file:///app/index.html' })
    expect(cb).toHaveBeenLastCalledWith(true)
    request(wc, 'geolocation', cb, { requestingUrl: 'file:///app/index.html' })
    request({}, 'media', cb, { requestingUrl: 'file:///app/index.html' })
    expect(cb.mock.calls).toEqual([[true], [false], [false]])
    expect(check(wc, 'media', 'file:///')).toBe(true)
    expect(check(wc, 'clipboard-read', 'file:///')).toBe(false)
  })

  it('refuses video capture and sub-frames', () => {
    expect(permissionAllowed('media', 'file:///app/index.html', undefined, ['audio'])).toBe(true)
    expect(permissionAllowed('media', 'file:///app/index.html', undefined, ['audio', 'video'])).toBe(false)
    const { wc, request, check } = setup()
    const cb = vi.fn()
    request(wc, 'media', cb, { requestingUrl: 'file:///app/index.html', isMainFrame: false } as never)
    expect(cb).toHaveBeenCalledWith(false)
    expect(check(wc, 'media', 'file:///', { requestingUrl: 'file:///x', isMainFrame: false } as never)).toBe(false)
  })

  it('denies webview attachment', () => {
    const { attach } = setup()
    const preventDefault = vi.fn()
    attach({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })
})
