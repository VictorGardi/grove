import { describe, expect, it } from 'vitest'
import { canonicalBinding, defaultFile, FILES, validateFile, type ConfigFile } from './schema.ts'

const withFile = (file: ConfigFile, patch: Record<string, unknown>) => ({ ...defaultFile(file), ...patch })

describe('config schema', () => {
  it('accepts the defaults of every file', () => {
    for (const file of FILES) {
      expect(validateFile(file, defaultFile(file)).ok).toBe(true)
    }
  })

  it('reads a file into its section of the values', () => {
    expect(validateFile('settings.json', withFile('settings.json', { sidebarWidth: 300 }))).toEqual({
      ok: true,
      value: { sidebarWidth: 300 },
    })
    expect(validateFile('theme.json', withFile('theme.json', { tokens: { accent: '#ff0000' } }))).toEqual({
      ok: true,
      value: { accent: '#ff0000' },
    })
  })

  it('rejects a missing version, an unknown key, a wrong type and an out-of-range width, naming the file', () => {
    expect(validateFile('settings.json', { sidebarWidth: 200 })).toEqual({
      ok: false,
      message: 'settings.json: "version" must be 1',
    })
    expect(validateFile('settings.json', withFile('settings.json', { version: 2 })).ok).toBe(false)
    const unknown = validateFile('settings.json', withFile('settings.json', { colour: 'red' }))
    expect(unknown).toEqual({ ok: false, message: 'settings.json: unknown key "colour"' })
    const wrongType = validateFile('settings.json', withFile('settings.json', { sidebarWidth: '240' }))
    expect(wrongType).toEqual({
      ok: false,
      message: 'settings.json: sidebarWidth: must be an integer from 180 to 480',
    })
    const tooWide = validateFile('settings.json', withFile('settings.json', { sidebarWidth: 481 }))
    expect(tooWide.ok).toBe(false)
    expect(validateFile('settings.json', withFile('settings.json', { sidebarWidth: 200.5 })).ok).toBe(false)
  })

  it('has every key action with its default', () => {
    expect(validateFile('keys.json', defaultFile('keys.json'))).toEqual({
      ok: true,
      value: {
        'grid-toggle': 'mod+g',
        'new-shell': 'mod+t',
        'new-space': 'mod+n',
        'close-tab': 'mod+w',
        'previous-tab': 'ctrl+tab',
        'grid-tab': 'mod+shift+g',
        'grid-reset-layout': 'mod+shift+l',
        'next-urgent': 'mod+.',
        palette: 'mod+p',
        'sidebar-toggle': 'mod+b',
        notes: 'mod+shift+n',
        diff: 'mod+shift+d',
        'zoom-in': 'mod+=',
        'zoom-out': 'mod+-',
        'zoom-reset': 'mod+0',
        'space-1': 'mod+1',
        'space-2': 'mod+2',
        'space-3': 'mod+3',
        'space-4': 'mod+4',
        'space-5': 'mod+5',
        'space-6': 'mod+6',
        'space-7': 'mod+7',
        'space-8': 'mod+8',
        'space-9': 'mod+9',
      },
    })
  })

  it('accepts = and - as keys, so the zoom actions can be mod+= and mod+-', () => {
    expect(canonicalBinding('shift+mod+=')).toBe('mod+shift+=')
    expect(canonicalBinding('mod+-')).toBe('mod+-')
  })

  it('accepts a period as the key, so next-urgent can be mod+.', () => {
    expect(validateFile('keys.json', withFile('keys.json', { 'next-urgent': 'shift+mod+.' })).ok).toBe(true)
    expect(canonicalBinding('shift+mod+.')).toBe('mod+shift+.')
  })

  it('accepts ctrl and the tab key, so previous-tab can be ctrl+tab', () => {
    expect(validateFile('keys.json', withFile('keys.json', { 'previous-tab': 'ctrl+tab' })).ok).toBe(true)
    expect(validateFile('keys.json', withFile('keys.json', { 'previous-tab': 'shift+ctrl+tab' })).ok).toBe(true)
    expect(validateFile('keys.json', withFile('keys.json', { 'previous-tab': 'tab' })).ok).toBe(false)
    expect(validateFile('keys.json', withFile('keys.json', { 'previous-tab': 'ctrl+f1' })).ok).toBe(false)
  })

  it('reports a space or grid binding that another action already has', () => {
    expect(validateFile('keys.json', withFile('keys.json', { 'space-3': 'mod+g' }))).toEqual({
      ok: false,
      message: 'keys.json: space-3: same binding as grid-toggle',
    })
    expect(validateFile('keys.json', withFile('keys.json', { 'grid-tab': 'mod+b' }))).toEqual({
      ok: false,
      message: 'keys.json: sidebar-toggle: same binding as grid-tab',
    })
  })

  it('rejects a duplicate key binding, and accepts the same modifiers in another order only as a duplicate', () => {
    const duplicate = validateFile('keys.json', withFile('keys.json', { 'new-shell': 'mod+g' }))
    expect(duplicate).toEqual({ ok: false, message: 'keys.json: new-shell: same binding as grid-toggle' })
    const reordered = validateFile('keys.json', withFile('keys.json', { 'new-space': 'shift+mod+w', 'close-tab': 'mod+shift+x' }))
    expect(reordered.ok).toBe(true)
    const samePair = validateFile('keys.json', withFile('keys.json', { 'close-tab': 'mod+n' }))
    expect(samePair).toEqual({ ok: false, message: 'keys.json: close-tab: same binding as new-space' })
  })

  it('rejects the removed Claude, OpenCode and Copilot key actions', () => {
    for (const action of ['new-claude', 'new-opencode', 'new-copilot']) {
      expect(validateFile('keys.json', withFile('keys.json', { [action]: 'mod+shift+1' }))).toEqual({
        ok: false,
        message: `keys.json: unknown key "${action}"`,
      })
    }
  })

  it('rejects a binding that is not a modifier and a key, and an unknown action', () => {
    expect(validateFile('keys.json', withFile('keys.json', { 'grid-toggle': 'g' })).ok).toBe(false)
    expect(validateFile('keys.json', withFile('keys.json', { 'grid-toggle': 'mod+G' })).ok).toBe(false)
    expect(validateFile('keys.json', withFile('keys.json', { 'grid-toggle': 'mod+x+g' })).ok).toBe(false)
    expect(validateFile('keys.json', withFile('keys.json', { 'zoom': 'mod+z' }))).toEqual({
      ok: false,
      message: 'keys.json: unknown key "zoom"',
    })
  })

  it('rejects an unknown theme token and a value with a semicolon', () => {
    expect(validateFile('theme.json', withFile('theme.json', { tokens: { nope: '#fff' } }))).toEqual({
      ok: false,
      message: 'theme.json: tokens: unknown token "nope"',
    })
    const injected = validateFile('theme.json', withFile('theme.json', { tokens: { accent: 'red; color: blue' } }))
    expect(injected).toEqual({
      ok: false,
      message: expect.stringMatching(/^theme\.json: tokens: token "accent" must be/),
    })
    expect(validateFile('theme.json', withFile('theme.json', { tokens: { accent: 'url(x)' } })).ok).toBe(false)
  })

  it('validates launchers: id shape, uniqueness, and the fields of each', () => {
    const launcher = { id: 'plan', label: 'Plan', command: 'claude', args: ['plan'], env: { MODE: 'plan' } }
    expect(validateFile('launchers.json', withFile('launchers.json', { launchers: [launcher] }))).toEqual({
      ok: true,
      value: [launcher],
    })
    const bad = (item: Record<string, unknown>) => validateFile('launchers.json', withFile('launchers.json', { launchers: [item] }))
    expect(bad({ ...launcher, id: 'Plan!' }).ok).toBe(false)
    expect(bad({ ...launcher, extra: 1 })).toEqual({ ok: false, message: 'launchers.json: launchers: launcher 1: unknown key "extra"' })
    expect(bad({ ...launcher, env: { '1BAD': 'x' } }).ok).toBe(false)
    const twice = validateFile('launchers.json', withFile('launchers.json', { launchers: [launcher, launcher] }))
    expect(twice).toEqual({ ok: false, message: 'launchers.json: launchers: launcher 2: id "plan" is used by another launcher' })
  })

  it('requires the sidebar order to list both sections once', () => {
    expect(validateFile('layout.json', withFile('layout.json', { sidebarOrder: ['agents', 'spaces'] })).ok).toBe(true)
    expect(validateFile('layout.json', withFile('layout.json', { sidebarOrder: ['spaces'] })).ok).toBe(false)
    expect(validateFile('layout.json', withFile('layout.json', { sidebarOrder: ['spaces', 'spaces'] })).ok).toBe(false)
  })
})

describe('canonicalBinding', () => {
  it('puts the modifiers in a fixed order and needs one modifier and one letter or digit', () => {
    expect(canonicalBinding('mod+g')).toBe('mod+g')
    expect(canonicalBinding('shift+alt+mod+9')).toBe('mod+alt+shift+9')
    expect(canonicalBinding('g')).toBeNull()
    expect(canonicalBinding('mod+')).toBeNull()
    expect(canonicalBinding('mod+shift')).toBeNull()
    expect(canonicalBinding('mod+mod+g')).toBeNull()
  })

  it('takes tab as a key and ctrl as a modifier, in the fixed order', () => {
    expect(canonicalBinding('shift+ctrl+tab')).toBe('ctrl+shift+tab')
    expect(canonicalBinding('tab')).toBeNull()
    expect(canonicalBinding('mod+enter')).toBeNull()
  })
})
