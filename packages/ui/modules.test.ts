// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { Dock } from './dock.ts'
import { createHostBus, mountModules, type DockModule } from './modules.ts'

describe('host bus', () => {
  it('delivers in subscription order and survives a listener that throws', () => {
    const report = vi.fn()
    const bus = createHostBus(report)
    const seen: string[] = []
    bus.on('connectionChanged', () => seen.push('a'))
    bus.on('connectionChanged', () => {
      throw new Error('boom')
    })
    bus.on('connectionChanged', ({ open }) => seen.push(`c${open}`))
    bus.emit('connectionChanged', { open: true })
    expect(seen).toEqual(['a', 'ctrue'])
    expect(report).toHaveBeenCalledTimes(1)
  })
})

describe('module rail', () => {
  const dock = { register: vi.fn(), toggle: vi.fn(async () => undefined) } as unknown as Dock
  const module = (id: string, label: string | null): DockModule => ({
    panel: { id, title: id, mount: () => ({ focus() {}, destroy() {} }) },
    button: { icon: 'notes', label, tooltip: id },
    keyAction: id === 'notes' ? 'notes' : 'diff',
    follow: vi.fn(),
  })

  it('builds a button per module, toggles by key action and marks the open one', () => {
    const rail = document.createElement('div')
    const bus = createHostBus(() => {})
    const modules = [module('notes', null), module('diff', 'Changes')]
    const mounted = mountModules(modules, rail, dock, bus, () => {})
    const [notes, diff] = Array.from(rail.querySelectorAll('button'))
    expect(notes?.className).toBe('icon-pill dock-toggle')
    expect(diff?.className).toBe('pill dock-toggle')
    expect(diff?.textContent).toBe('Changes')
    expect(modules[1]?.follow).toHaveBeenCalledWith(bus)
    mounted.toggle('diff')?.()
    expect(dock.toggle).toHaveBeenCalledWith('diff')
    expect(mounted.toggle('grid-toggle')).toBeUndefined()
    mounted.pressed('diff')
    expect([notes?.getAttribute('aria-pressed'), diff?.getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    mounted.paintShortcuts((action) => `<${action}>`)
    expect(notes?.title).toBe('notes (<notes>)')
  })
})
