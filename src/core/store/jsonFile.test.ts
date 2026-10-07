import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { atomicWrite, readVersioned } from './jsonFile'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
const empty = { schemaVersion: 1, x: 0 }

describe('atomicWrite', () => {
  it('creates parent dirs, writes content and leaves no tmp file', () => {
    const dir = tmp()
    const file = path.join(dir, 'a', 'b', 'f.json')
    atomicWrite(file, 'hello')
    expect(fs.readFileSync(file, 'utf8')).toBe('hello')
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('readVersioned', () => {
  it('returns empty for a missing file without calling onBad', () => {
    const onBad = vi.fn()
    expect(readVersioned(path.join(tmp(), 'nope.json'), 1, empty, onBad)).toBe(empty)
    expect(onBad).not.toHaveBeenCalled()
  })

  it('returns the parsed object', () => {
    const file = path.join(tmp(), 'f.json')
    fs.writeFileSync(file, '{"schemaVersion":1,"x":2}')
    expect(readVersioned(file, 1, empty)).toEqual({ schemaVersion: 1, x: 2 })
  })

  it.each([
    ['bad JSON', '{'],
    ['unknown schemaVersion', '{"schemaVersion":2}'],
  ])('moves a file with %s aside and returns empty', (_, content) => {
    const dir = tmp()
    const file = path.join(dir, 'f.json')
    fs.writeFileSync(file, content)
    const onBad = vi.fn()
    expect(readVersioned(file, 1, empty, onBad)).toBe(empty)
    expect(onBad).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(dir)).toEqual([expect.stringMatching(/^f\.json\.bad-\d+$/)])
  })

  it('migrates an older version through each step without moving the file', () => {
    const file = path.join(tmp(), 'f.json')
    fs.writeFileSync(file, '{"schemaVersion":1,"x":2}')
    const onBad = vi.fn()
    const migrations = { 1: (o: { x: number }) => ({ ...o, y: o.x }) }
    expect(readVersioned(file, 2, { schemaVersion: 2, x: 0, y: 0 }, onBad, migrations)).toEqual({ schemaVersion: 2, x: 2, y: 2 })
    expect(onBad).not.toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe('{"schemaVersion":1,"x":2}')
  })

  it('moves aside a version with no migration', () => {
    const dir = tmp()
    const file = path.join(dir, 'f.json')
    fs.writeFileSync(file, '{"schemaVersion":0}')
    const onBad = vi.fn()
    const empty2 = { schemaVersion: 2 }
    expect(readVersioned(file, 2, empty2, onBad, { 1: (o: object) => o })).toBe(empty2)
    expect(onBad).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(dir)).toEqual([expect.stringMatching(/^f\.json\.bad-\d+$/)])
  })
})
