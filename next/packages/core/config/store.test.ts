import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from './store.ts'
import { DEFAULT_VALUES, FILES } from './schema.ts'

describe('config store', () => {
  let dir: string
  let store: ConfigStore

  const write = (file: string, text: string) => fs.writeFileSync(path.join(dir, file), text)
  const settingsFile = path.join('settings.json')

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-config-')), 'config')
    store = new ConfigStore(dir)
  })

  afterEach(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true })
  })

  it('writes the defaults for missing files and reads them', () => {
    store.load()
    expect(FILES.every((file) => fs.existsSync(path.join(dir, file)))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, settingsFile), 'utf8'))).toEqual({ version: 1, sidebarWidth: 240 })
    expect(store.snapshot()).toEqual({ path: dir, values: DEFAULT_VALUES, notes: {} })
  })

  it('keeps a file the user already wrote', () => {
    fs.mkdirSync(dir, { recursive: true })
    write(settingsFile, JSON.stringify({ version: 1, sidebarWidth: 300 }))
    store.load()
    expect(store.snapshot().values.settings).toEqual({ sidebarWidth: 300 })
    expect(JSON.parse(fs.readFileSync(path.join(dir, settingsFile), 'utf8'))).toEqual({ version: 1, sidebarWidth: 300 })
  })

  it('keeps the last good value and a note when an edit is invalid, and clears the note when it is fixed', () => {
    store.load()
    write(settingsFile, JSON.stringify({ version: 1, sidebarWidth: 300 }))
    expect(store.reload(['settings.json'])).toBe(true)

    write(settingsFile, JSON.stringify({ version: 1, sidebarWidth: 9000 }))
    expect(store.reload(['settings.json'])).toBe(false)
    const broken = store.snapshot()
    expect(broken.values.settings).toEqual({ sidebarWidth: 300 })
    expect(broken.notes).toEqual({
      'settings.json': 'settings.json: sidebarWidth: must be an integer from 180 to 480',
    })

    write(settingsFile, '{not json')
    store.reload(['settings.json'])
    expect(store.snapshot().notes['settings.json']).toMatch(/^settings\.json: not valid JSON/)
    expect(store.snapshot().values.settings).toEqual({ sidebarWidth: 300 })

    write(settingsFile, JSON.stringify({ version: 1, sidebarWidth: 200 }))
    expect(store.reload(['settings.json'])).toBe(true)
    expect(store.snapshot()).toEqual({ path: dir, values: expect.objectContaining({ settings: { sidebarWidth: 200 } }), notes: {} })
  })

  it('returns false from reload when nothing changed', () => {
    store.load()
    expect(store.reload()).toBe(false)
    expect(store.reload(['settings.json', 'keys.json'])).toBe(false)
  })

  it('reloads every file when no names are given', () => {
    store.load()
    write('theme.json', JSON.stringify({ version: 1, tokens: { accent: '#00ff00' } }))
    write('layout.json', JSON.stringify({ version: 1, sidebarOrder: ['agents', 'spaces'] }))
    expect(store.reload()).toBe(true)
    const { values } = store.snapshot()
    expect(values.theme).toEqual({ accent: '#00ff00' })
    expect(values.layout).toEqual({ sidebarOrder: ['agents', 'spaces'] })
  })

  describe('setKey', () => {
    const keysFile = () => path.join(dir, 'keys.json')

    it('writes only the changed key, keeps the others and a backup, and applies it', () => {
      store.load()
      write('keys.json', JSON.stringify({ version: 1, notes: 'mod+shift+m' }))
      store.reload(['keys.json'])
      store.setKey('next-urgent', 'shift+mod+.')
      expect(JSON.parse(fs.readFileSync(keysFile(), 'utf8'))).toEqual({ version: 1, notes: 'mod+shift+m', 'next-urgent': 'mod+shift+.' })
      expect(JSON.parse(fs.readFileSync(`${keysFile()}.bak`, 'utf8'))).toEqual({ version: 1, notes: 'mod+shift+m' })
      expect(store.snapshot().values.keys['next-urgent']).toBe('mod+shift+.')
      expect(store.snapshot().values.keys.notes).toBe('mod+shift+m')
    })

    it('refuses a binding another action has, and changes nothing', () => {
      store.load()
      const before = fs.readFileSync(keysFile(), 'utf8')
      expect(() => store.setKey('next-urgent', 'mod+g')).toThrow('same binding as grid-toggle')
      expect(fs.readFileSync(keysFile(), 'utf8')).toBe(before)
    })

    it('refuses text that is not a binding and an unknown action', () => {
      store.load()
      expect(() => store.setKey('notes', 'tab')).toThrow('key binding')
      expect(() => store.setKey('nope' as never, 'mod+j')).toThrow('unknown key action')
    })

    it('refuses to rewrite a keys.json that is not valid JSON', () => {
      store.load()
      write('keys.json', '{ nope')
      expect(() => store.setKey('notes', 'mod+j')).toThrow('cannot be changed')
      expect(fs.readFileSync(keysFile(), 'utf8')).toBe('{ nope')
    })
  })
})
