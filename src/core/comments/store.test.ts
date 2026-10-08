import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Comment } from '@shared/types'
import { loadComments, saveComments } from './store'

const note: Comment = {
  id: 'c1', sessionId: 's', anchor: { kind: 'note' }, body: 'hi', state: 'draft', orphaned: false,
  createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', sentAt: null,
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-c-')), 'comments.json')

describe('comments store', () => {
  it('starts empty when the file is missing', () => {
    expect(loadComments(tmp())).toEqual({ schemaVersion: 2, comments: [] })
  })

  it('round-trips', () => {
    const file = tmp()
    saveComments(file, { schemaVersion: 2, comments: [note] })
    expect(loadComments(file).comments).toEqual([note])
  })

  it('migrates v1: drafts on artifacts are dropped, sent ones become file anchors labelled slug/path', () => {
    const file = tmp()
    const anchor = { kind: 'artifact', projectId: 'p', slug: 'f', path: '03-design.md', exact: 'e', prefix: '', suffix: '', start: 1, end: 1 }
    const cs = [{ ...note, id: 'd', state: 'draft', anchor }, { ...note, id: 's', state: 'sent', anchor }, note]
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, comments: cs }))
    const out = loadComments(file)
    expect(out.schemaVersion).toBe(2)
    expect(out.comments.map((c) => c.id)).toEqual(['s', note.id])
    expect(out.comments[0].anchor).toEqual({ kind: 'file', projectId: 'p', path: 'f/03-design.md', exact: 'e', prefix: '', suffix: '', start: 1, end: 1 })
  })

  it('moves a bad file aside and reports it', () => {
    const file = tmp()
    fs.writeFileSync(file, '{nope')
    const bad: string[] = []
    expect(loadComments(file, (m) => bad.push(m)).comments).toEqual([])
    expect(bad).toHaveLength(1)
    expect(fs.existsSync(file)).toBe(false)
  })
})
