import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanRecords, SpoolTail, type SpoolRecord } from './spool'

const rec = (t: string, e: unknown = {}) => JSON.stringify({ t, e })

describe('scanRecords', () => {
  it('splits glued records', () => {
    const text = rec('a') + rec('b') + '\n'
    expect(scanRecords(text).records.map((r) => r.t)).toEqual(['a', 'b'])
  })

  it('takes a complete last record without a trailing newline', () => {
    const text = rec('a') + '\n' + rec('b')
    expect(scanRecords(text)).toEqual({ records: [{ t: 'a', e: {} }, { t: 'b', e: {} }], consumed: text.length })
  })

  it('leaves a trailing incomplete record for later', () => {
    const first = rec('a')
    const r = scanRecords(`${first}\n{"t":"2026`)
    expect(r).toEqual({ records: [{ t: 'a', e: {} }], consumed: first.length })
  })

  it('skips a corrupt span that never closes', () => {
    expect(scanRecords(`{"t":"a","e":{"x":${rec('b')}\n`).records.map((r) => r.t)).toEqual(['b'])
  })

  it('skips an interleaved span and keeps the record inside it', () => {
    expect(scanRecords(`{"t":"a","e":{"x":${rec('b')}1}}\n`).records.map((r) => r.t)).toEqual(['b'])
  })

  it('skips objects that are not records', () => {
    const text = '{"t":"a","e":1}\n{"t":"b"}\n' + rec('c')
    expect(scanRecords(text).records.map((r) => r.t)).toEqual(['c'])
  })

  it('reads braces and escaped quotes inside strings', () => {
    const e = { s: 'a } b \\" {"t":"x' }
    expect(scanRecords(rec('a', e)).records).toEqual([{ t: 'a', e }])
  })
})

describe('SpoolTail', () => {
  const tails: SpoolTail[] = []
  afterEach(() => { for (const t of tails.splice(0)) t.stop() })

  function setup() {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'agents', 'claude')
    const got: { id: string; records: SpoolRecord[]; initial: boolean }[] = []
    const tail = new SpoolTail(dir, (id, records, initial) => got.push({ id, records, initial }))
    tails.push(tail)
    const append = (id: string, s: string) => fs.appendFileSync(path.join(dir, `${id}.jsonl`), s)
    return { dir, got, tail, append }
  }

  it('creates the dir private, replays existing records as initial, then only appended ones', () => {
    const { dir, got, tail, append } = setup()
    fs.mkdirSync(dir, { recursive: true })
    fs.chmodSync(dir, 0o700)
    append('u', rec('a') + '\n')
    tail.start()
    expect(got).toEqual([{ id: 'u', records: [{ t: 'a', e: {} }], initial: true }])
    append('u', rec('b') + '\n')
    tail.poll()
    expect(got.slice(1)).toEqual([{ id: 'u', records: [{ t: 'b', e: {} }], initial: false }])
    tail.poll()
    expect(got).toHaveLength(2)
  })

  it('creates a missing dir with mode 0700', () => {
    const { dir, tail } = setup()
    tail.start()
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('delivers a record split across appends once, whole', () => {
    const { got, tail, append } = setup()
    tail.start()
    const r = rec('a', { x: 1 })
    append('u', r.slice(0, 10))
    tail.poll()
    expect(got).toEqual([])
    append('u', r.slice(10) + '\n')
    tail.poll()
    expect(got).toEqual([{ id: 'u', records: [{ t: 'a', e: { x: 1 } }], initial: false }])
  })

  it('reads a file created after start from byte 0, with multibyte text intact', () => {
    const { got, tail, append } = setup()
    tail.start()
    append('v', rec('a', { s: 'å👋' }) + '\n' + rec('b'))
    tail.poll()
    expect(got).toEqual([{ id: 'v', records: [{ t: 'a', e: { s: 'å👋' } }, { t: 'b', e: {} }], initial: false }])
    append('v', '\n' + rec('c', { s: 'ö' }))
    tail.poll()
    expect(got[1]).toEqual({ id: 'v', records: [{ t: 'c', e: { s: 'ö' } }], initial: false })
  })

  it('picks up appends by itself, and stops delivering after stop()', async () => {
    const { got, tail, append } = setup()
    tail.start()
    append('u', rec('a') + '\n')
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 3000 })
    tail.stop()
    append('u', rec('b') + '\n')
    tail.poll()
    await new Promise((r) => setTimeout(r, 1200))
    expect(got).toHaveLength(1)
  })
})
