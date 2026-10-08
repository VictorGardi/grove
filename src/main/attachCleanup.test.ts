import { describe, expect, it, vi } from 'vitest'
import { installAttachCleanup } from './attachCleanup'

describe('attach cleanup navigation', () => {
  it('kills attaches for a main-frame document navigation, not an iframe or in-page navigation', () => {
    const listeners: ((isInPlace: boolean, isMainFrame: boolean) => void)[] = []
    const killAttaches = vi.fn()
    installAttachCleanup((listener) => listeners.push(listener), killAttaches)
    const navigate = listeners[0]

    navigate(false, false)
    expect(killAttaches).not.toHaveBeenCalled()

    navigate(true, true)
    expect(killAttaches).not.toHaveBeenCalled()

    navigate(false, true)
    expect(killAttaches).toHaveBeenCalledOnce()
  })
})
