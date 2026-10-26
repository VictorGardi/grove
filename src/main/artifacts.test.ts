import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ViewerTarget } from '@shared/types'
import type { Core } from '../core/core'

const openExternal = vi.fn()
vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/app' },
  shell: { openExternal: (url: string) => openExternal(url) },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))
vi.mock('mermaid/dist/mermaid.min.js?asset', () => ({ default: '/app/mermaid.min.js' }))

const { guardNavigation } = await import('./artifacts')

// The guard with a fake window: the 'will-frame-navigate' listener is captured and fed events.
describe('guardNavigation', () => {
  const main = { frameTreeNodeId: 1 }
  const sub = { frameTreeNodeId: 7 }
  let listener: (e: object) => void
  let viewer: ViewerTarget | null
  const uiSet = vi.fn()

  beforeEach(() => {
    openExternal.mockReset()
    uiSet.mockReset()
    viewer = { kind: 'file', projectId: 'p', path: 'docs/a.md', hash: null, fromDiff: null } as ViewerTarget
    const wc = {
      mainFrame: main,
      getURL: () => 'file:///app/index.html',
      on: (_: string, fn: (e: object) => void) => { listener = fn },
      setWindowOpenHandler: vi.fn(),
    }
    const core = { getSlices: () => ({ ui: { viewer } }), commands: { uiSet } } as unknown as Core
    guardNavigation({ webContents: wc } as unknown as BrowserWindow, core)
  })

  const navigate = (url: string, initiator: object | null) => {
    const e = { url, isMainFrame: false, initiator, preventDefault: vi.fn() }
    listener(e)
    return e.preventDefault
  }

  it("lets the app's own loads through: a card preview set by the main frame is not the viewer", () => {
    expect(navigate('grove-artifact://p/docs/b.html', { frameTreeNodeId: main.frameTreeNodeId })).not.toHaveBeenCalled()
    expect(uiSet).not.toHaveBeenCalled()
  })

  it('sends a link clicked inside an artifact frame through uiSet', () => {
    expect(navigate('grove-artifact://p/docs/b.html', sub)).toHaveBeenCalled()
    expect(uiSet).toHaveBeenCalledWith({ viewer: expect.objectContaining({ projectId: 'p', path: 'docs/b.html' }) })
  })

  it('lets the current viewer doc through whoever started it', () => {
    expect(navigate('grove-artifact://p/docs/a.md', sub)).not.toHaveBeenCalled()
    expect(navigate('grove-artifact://p/docs/a.md', null)).not.toHaveBeenCalled()
    expect(uiSet).not.toHaveBeenCalled()
  })

  it('lets the main frame reload its own page, hash aside', () => {
    const e = { url: 'file:///app/index.html#x', isMainFrame: true, initiator: null, preventDefault: vi.fn() }
    listener(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('stops the main frame navigating anywhere else', () => {
    const e = { url: 'file:///app/other.html', isMainFrame: true, initiator: null, preventDefault: vi.fn() }
    listener(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    expect(uiSet).not.toHaveBeenCalled()
  })

  it('opens a web link in the browser and denies other schemes, even from the main frame', () => {
    expect(navigate('https://example.com/', sub)).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
    expect(navigate('file:///etc/passwd', main)).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(uiSet).not.toHaveBeenCalled()
  })
})
