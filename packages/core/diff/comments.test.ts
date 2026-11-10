import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DIFF_COMMENT_LIMITS } from '../../protocol/messages.ts'
import { SpacesService } from '../spaces.ts'
import { loadState } from '../store/state.ts'
import { commentChangeParams, newCommentParams } from './comments.ts'

const input = { path: 'src/a.ts', side: 'new', line: 3, anchor: 'let a = 1', before: ['x'], after: ['y'], body: 'why?' }

describe('diff comments in the store', () => {
  let dir: string
  let file: string
  let service: SpacesService

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-comments-'))
    file = path.join(dir, 'state.json')
    service = new SpacesService(file)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('adds, lists, updates and deletes per folder, with ids and times made by the core', () => {
    expect(service.diffComments('/r')).toEqual([])
    const a = service.addDiffComment('/r', newCommentParams(input))
    const b = service.addDiffComment('/r', newCommentParams({ ...input, line: 4, body: 'second' }))
    service.addDiffComment('/other', newCommentParams(input))
    expect(a).toMatchObject({ ...input, state: 'pending' })
    expect(a.id).not.toBe(b.id)
    expect(typeof a.createdAt).toBe('number')
    expect(service.diffComments('/r').map((c) => c.id)).toEqual([a.id, b.id])
    expect(service.diffComments('/other')).toHaveLength(1)

    expect(service.updateDiffComment('/r', { id: a.id, body: 'edited' }).body).toBe('edited')
    expect(service.updateDiffComment('/r', { id: a.id, state: 'resolved' })).toMatchObject({ body: 'edited', state: 'resolved' })
    expect(service.updateDiffComment('/r', { id: a.id, state: 'pending' }).state).toBe('pending')
    service.deleteDiffComment('/r', a.id)
    expect(service.diffComments('/r').map((c) => c.id)).toEqual([b.id])
    expect(() => service.deleteDiffComment('/r', a.id)).toThrow('no such comment')
    expect(() => service.updateDiffComment('/r', { id: 'nope', body: 'x' })).toThrow('no such comment')
  })

  it('keeps the comments across a restart of the store', () => {
    const a = service.addDiffComment('/r', newCommentParams(input))
    service.updateDiffComment('/r', { id: a.id, state: 'resolved' })
    const again = new SpacesService(file)
    expect(again.diffComments('/r')).toEqual([{ ...a, state: 'resolved' }])
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('refuses a 501st comment in a folder and still takes one in another', () => {
    for (let i = 0; i < DIFF_COMMENT_LIMITS.perFolder; i++) service.addDiffComment('/r', newCommentParams(input))
    expect(() => service.addDiffComment('/r', newCommentParams(input))).toThrow('at most 500')
    expect(service.diffComments('/r')).toHaveLength(DIFF_COMMENT_LIMITS.perFolder)
    expect(service.addDiffComment('/other', newCommentParams(input)).state).toBe('pending')
  })

  it('refuses to write while the state is refused', () => {
    const refused = path.join(dir, 'refused.json')
    fs.writeFileSync(refused, JSON.stringify({ version: 2, spaces: [], tabs: [] }))
    expect(() => new SpacesService(refused).addDiffComment('/r', newCommentParams(input))).toThrow('version 2')
  })
})

describe('diff comments in the state file', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-comments-'))
    file = path.join(dir, 'state.json')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('loads a file without the section unchanged', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, spaces: [], tabs: [] }))
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(new SpacesService(file).diffComments('/r')).toEqual([])
  })

  it('sets aside a file whose section is not an object', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, spaces: [], tabs: [], diffComments: [] }))
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.readdirSync(dir).some((name) => name.startsWith('state.json.corrupt-'))).toBe(true)
  })

  it('leaves out entries that do not read right', () => {
    const good = { id: 'g', path: 'a', side: 'old', line: 1, anchor: '', before: [], after: [], body: 'ok', state: 'sent', createdAt: 1 }
    fs.writeFileSync(file, JSON.stringify({ version: 1, spaces: [], tabs: [], diffComments: { '/r': [good, { id: 'bad' }, null, { ...good, state: 'odd' }], '/x': 'no' } }))
    const service = new SpacesService(file)
    expect(service.diffComments('/r')).toEqual([good])
    expect(service.diffComments('/x')).toEqual([])
  })
})

describe('diff comment params', () => {
  it('cuts long lines and context, and takes the last lines before and the first after', () => {
    const long = 'x'.repeat(DIFF_COMMENT_LIMITS.line + 50)
    const got = newCommentParams({ ...input, anchor: long, before: ['1', '2', '3'], after: ['4', '5', '6'] })
    expect(got.anchor).toHaveLength(DIFF_COMMENT_LIMITS.line)
    expect(got.before).toEqual(['2', '3'])
    expect(got.after).toEqual(['4', '5'])
  })

  it('takes a range: the anchor has one text per line, the end is after the start and within 100 lines', () => {
    const range = newCommentParams({ ...input, line: 3, endLine: 5, anchor: 'a\nb\nc' })
    expect(range).toMatchObject({ line: 3, endLine: 5, anchor: 'a\nb\nc' })
    expect(newCommentParams(input)).not.toHaveProperty('endLine')
    const bad = (over: Record<string, unknown>) => () => newCommentParams({ ...input, line: 3, ...over })
    expect(bad({ endLine: 5, anchor: 'a\nb' })).toThrow('text of the 3 commented lines')
    expect(bad({ endLine: 3, anchor: 'a' })).toThrow('endLine must be')
    expect(bad({ endLine: 2, anchor: 'a' })).toThrow('endLine must be')
    expect(bad({ endLine: 'x' })).toThrow('endLine must be')
    expect(bad({ endLine: 103, anchor: Array(101).fill('a').join('\n') })).toThrow('endLine must be')
    expect(bad({ endLine: 102, anchor: Array(100).fill('a').join('\n') })).not.toThrow()
  })

  it('refuses bad params with a clear message', () => {
    const add = (over: Record<string, unknown>) => () => newCommentParams({ ...input, ...over })
    expect(add({ body: '' })).toThrow('must not be empty')
    expect(add({ body: '  \n' })).toThrow('must not be empty')
    expect(add({ body: 'x'.repeat(DIFF_COMMENT_LIMITS.body + 1) })).toThrow('10000 characters or fewer')
    expect(add({ body: 'x'.repeat(DIFF_COMMENT_LIMITS.body) })).not.toThrow()
    expect(add({ side: 'left' })).toThrow('side must be old or new')
    expect(add({ line: 0 })).toThrow('positive whole number')
    expect(add({ line: 1.5 })).toThrow('positive whole number')
    expect(add({ path: '' })).toThrow('valid file path')
    expect(add({ anchor: 3 })).toThrow('anchor must be a string')
    expect(add({ before: 'x' })).toThrow('before must be a list')
    expect(add({ after: [1] })).toThrow('after must be a string')
  })

  it('refuses the state sent and an update with nothing to change', () => {
    expect(() => commentChangeParams({ id: 'a', state: 'sent' })).toThrow('only by sending')
    expect(() => commentChangeParams({ id: 'a', state: 'done' })).toThrow('pending or resolved')
    expect(() => commentChangeParams({ id: 'a' })).toThrow('nothing to change')
    expect(() => commentChangeParams({ id: 'a', body: '' })).toThrow('must not be empty')
    expect(commentChangeParams({ id: 'a', state: 'resolved' })).toEqual({ id: 'a', body: undefined, state: 'resolved' })
  })
})
