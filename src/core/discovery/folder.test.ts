import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorkflow, type Workflow } from '../workflow/parse'
import { listFolders, readFolder, resolveRoot } from './folder'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
const res = parseWorkflow(fs.readFileSync(new URL('../../../resources/workflow.yaml', import.meta.url), 'utf8'))
if (!res.ok) throw new Error(res.error)
const wf: Workflow = res.workflow

function write(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
}

describe('readFolder', () => {
  it('returns null without the manifest', () => {
    const dir = tmp()
    write(dir, { '01-questions.md': '---\nstatus: draft\n---\n' })
    expect(readFolder(dir, wf)).toBeNull()
  })

  it('parses existing stage artifacts only and lists non-dot files', () => {
    const dir = tmp()
    write(dir, {
      'feature.md': '---\nkind: feature\n---\n# Title\n',
      '01-questions.md': '---\nstatus: approved\n---\n',
      '02-research.html': '<html>',
      'notes.md': '---\nstatus: x\n---\n',
      '.hidden': '',
      'sub/inner.md': '',
    })
    const snap = readFolder(dir, wf)!
    expect(snap.slug).toBe(path.basename(dir))
    expect(snap.manifest.data).toEqual({ kind: 'feature' })
    expect(Object.keys(snap.artifacts)).toEqual(['01-questions.md'])
    expect(snap.artifacts['01-questions.md'].data).toEqual({ status: 'approved' })
    expect(snap.files).toEqual(['01-questions.md', '02-research.html', 'feature.md', 'notes.md'])
  })
})

describe('resolveRoot', () => {
  it('uses the key from from_file', () => {
    const dir = tmp()
    write(dir, { 'grove.config.json': '{"artifactRoot": "work/features"}', 'work/features/.keep': '' })
    expect(resolveRoot(dir, wf.discovery)).toBe(path.join(dir, 'work/features'))
  })

  it.each([
    ['the file is missing', {}],
    ['the key is missing', { 'grove.config.json': '{"other": 1}' }],
  ])('falls back to the default when %s', (_, files) => {
    const dir = tmp()
    write(dir, { ...files, 'docs/work/.keep': '' })
    expect(resolveRoot(dir, wf.discovery)).toBe(path.join(dir, 'docs/work'))
  })

  it('returns null when the directory does not exist', () => {
    expect(resolveRoot(tmp(), wf.discovery)).toBeNull()
  })
})

describe('listFolders', () => {
  it('returns non-dot subdirectories, sorted', () => {
    const dir = tmp()
    write(dir, { 'b/x': '', 'a/x': '', '.git/x': '', 'file.md': '' })
    expect(listFolders(dir)).toEqual(['a', 'b'])
  })
})
