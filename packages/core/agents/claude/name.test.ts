import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClaudeNameSource, findTranscript, nameOf, readLine, type TranscriptNames } from './name.ts'

const ID = '11111111-2222-3333-4444-555555555555'
const OTHER = '66666666-7777-8888-9999-000000000000'
const line = (record: unknown) => JSON.stringify(record)
const user = (content: unknown, extra: Record<string, unknown> = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra })

function names(...lines: string[]): TranscriptNames {
  const result: TranscriptNames = {}
  for (const entry of lines) readLine(result, entry)
  return result
}

describe('the name a transcript gives', () => {
  it('takes the first real prompt as a stand-in, as one line', () => {
    expect(nameOf(names(user('Why does the importer\ndrop empty rows?'), user('second')))).toBe('Why does the importer')
  })

  it('reads a prompt that is a list of parts, and skips images', () => {
    expect(nameOf(names(user([{ type: 'image' }, { type: 'text', text: 'look at this' }])))).toBe('look at this')
  })

  it('skips a slash-command wrapper, a meta record and a subagent record', () => {
    const result = names(user('<command-name>/clear</command-name>'), user('caveat', { isMeta: true }), user('delegated', { isSidechain: true }), user('the real one'))
    expect(nameOf(result)).toBe('the real one')
  })

  it('prefers a name the human or a skill set over one Claude made over the prompt', () => {
    expect(nameOf(names(user('first prompt'), line({ type: 'ai-title', aiTitle: 'made by claude' })))).toBe('made by claude')
    expect(nameOf(names(user('first prompt'), line({ type: 'ai-title', aiTitle: 'made by claude' }), line({ type: 'agent-name', agentName: 'from a skill' })))).toBe('from a skill')
  })

  it('uses the latest of the human-set names, from /rename or from --name', () => {
    expect(nameOf(names(line({ type: 'custom-title', customTitle: 'old' }), line({ type: 'agent-name', agentName: 'newer' })))).toBe('newer')
    expect(nameOf(names(line({ type: 'agent-name', agentName: 'kept' }), line({ type: 'agent-name', agentName: '  ' })))).toBe('kept')
  })

  it('skips lines that are not JSON without stopping', () => {
    expect(nameOf(names('{"type":"user" broken', line({ type: 'agent-name', agentName: 'ok' })))).toBe('ok')
  })

  it('has no name for a transcript with nothing to name it by', () => {
    expect(nameOf(names(line({ type: 'mode', mode: 'normal' })))).toBeUndefined()
  })
})

describe('watching a transcript', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-name-'))
    fs.mkdirSync(path.join(dir, 'projects', '-Users-me-repo'), { recursive: true })
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const transcript = (id = ID) => path.join(dir, 'projects', '-Users-me-repo', `${id}.jsonl`)
  const usageFile = () => path.join(dir, 'usage.json')
  const source = (onName: (name: string) => void, sessionId = ID) =>
    createClaudeNameSource({ usageFile: usageFile(), projectsDir: path.join(dir, 'projects'), sessionId, onName, intervalMs: 3_600_000 })

  it('finds the transcript in whichever project folder holds it', () => {
    fs.writeFileSync(transcript(), '')
    expect(findTranscript(path.join(dir, 'projects'), ID)).toBe(transcript())
    expect(findTranscript(path.join(dir, 'projects'), OTHER)).toBeUndefined()
    expect(findTranscript(path.join(dir, 'projects'), '../etc')).toBeUndefined()
  })

  it('delivers the stand-in first and the real name when it arrives, reading only what was added', () => {
    fs.writeFileSync(transcript(), user('fix the importer') + '\n')
    const onName = vi.fn()
    const watching = source(onName)
    expect(onName.mock.calls).toEqual([['fix the importer']])
    fs.appendFileSync(transcript(), line({ type: 'agent-name', agentName: 'importer-fix' }) + '\n')
    watching.drain()
    watching.drain()
    expect(onName.mock.calls).toEqual([['fix the importer'], ['importer-fix']])
    watching.close()
  })

  it('waits for a line that is only half written', () => {
    fs.writeFileSync(transcript(), '{"type":"agent-name","agentNa')
    const onName = vi.fn()
    const watching = source(onName)
    expect(onName).not.toHaveBeenCalled()
    fs.appendFileSync(transcript(), 'me":"whole"}\n')
    watching.drain()
    expect(onName.mock.calls).toEqual([['whole']])
    watching.close()
  })

  it('says nothing while the transcript does not exist yet', () => {
    const onName = vi.fn()
    const watching = source(onName)
    expect(onName).not.toHaveBeenCalled()
    fs.writeFileSync(transcript(), line({ type: 'agent-name', agentName: 'late' }) + '\n')
    watching.drain()
    expect(onName.mock.calls).toEqual([['late']])
    watching.close()
  })

  it('follows the session id in the usage file, which changes on /clear', () => {
    fs.writeFileSync(transcript(), line({ type: 'agent-name', agentName: 'before clear' }) + '\n')
    fs.writeFileSync(transcript(OTHER), line({ type: 'agent-name', agentName: 'after clear' }) + '\n')
    const onName = vi.fn()
    const watching = source(onName)
    fs.writeFileSync(usageFile(), JSON.stringify({ at: 1, payload: { session_id: OTHER } }))
    watching.drain()
    expect(onName.mock.calls).toEqual([['before clear'], ['after clear']])
    watching.close()
  })
})
