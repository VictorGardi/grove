import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadState, saveState, type StateV1 } from './state.ts'

describe('state store', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-state-'))
    file = path.join(dir, 'state.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty when there is no file', () => {
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
  })

  it('sets aside a file that is not JSON and starts empty', () => {
    fs.writeFileSync(file, '{not json')
    const result = loadState(file)
    expect(result).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.existsSync(file)).toBe(false)
    const corrupt = fs.readdirSync(dir).filter((name) => /^state\.json\.corrupt-\d+$/.test(name))
    expect(corrupt).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, corrupt[0]!), 'utf8')).toBe('{not json')
  })

  it('refuses a file with another version and leaves its bytes unchanged', () => {
    const bytes = '{"version": 2, "spaces": [], "tabs": [], "future": true}'
    fs.writeFileSync(file, bytes)
    const result = loadState(file)
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') expect(result.reason).toContain('version 2')
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
    expect(fs.readdirSync(dir)).toEqual(['state.json'])
  })

  it('refuses a file with no version, even when spaces and tabs are present, and leaves its bytes unchanged', () => {
    const bytes = '{"spaces":[{"path":"/a"}],"tabs":[]}'
    fs.writeFileSync(file, bytes)
    const result = loadState(file)
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') expect(result.reason).toContain('no version')
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
    expect(fs.readdirSync(dir)).toEqual(['state.json'])
  })

  it('refuses a version-2 file with a different shape and leaves its bytes unchanged', () => {
    const bytes = '{"version":2,"folders":[]}'
    fs.writeFileSync(file, bytes)
    const result = loadState(file)
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') expect(result.reason).toContain('version 2')
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
    expect(fs.readdirSync(dir)).toEqual(['state.json'])
  })

  it('sets aside a version-1 file whose spaces or tabs are not arrays', () => {
    const bytes = '{"version":1,"spaces":{},"tabs":[]}'
    fs.writeFileSync(file, bytes)
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.existsSync(file)).toBe(false)
    const corrupt = fs.readdirSync(dir).filter((name) => /^state\.json\.corrupt-\d+$/.test(name))
    expect(corrupt).toHaveLength(1)
  })

  it('sets aside a version-1 file with a null space entry and starts empty', () => {
    fs.writeFileSync(file, '{"version":1,"spaces":[null],"tabs":[]}')
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.existsSync(file)).toBe(false)
    const corrupt = fs.readdirSync(dir).filter((name) => /^state\.json\.corrupt-\d+$/.test(name))
    expect(corrupt).toHaveLength(1)
  })

  it('sets aside a version-1 file with a tab missing spacePath and starts empty', () => {
    fs.writeFileSync(file, '{"version":1,"spaces":[{"path":"/a"}],"tabs":[{"id":"abc12345"}]}')
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.existsSync(file)).toBe(false)
    const corrupt = fs.readdirSync(dir).filter((name) => /^state\.json\.corrupt-\d+$/.test(name))
    expect(corrupt).toHaveLength(1)
  })

  it('loads a version-1 file written before the agent fields, with neither set', () => {
    const bytes = '{"version":1,"spaces":[{"path":"/a"}],"tabs":[{"id":"abc12345","spacePath":"/a"}]}'
    fs.writeFileSync(file, bytes)
    const result = loadState(file)
    expect(result).toEqual({
      kind: 'ok',
      state: {
        version: 1,
        spaces: [{ id: '/a', path: '/a' }],
        tabs: [{ id: 'abc12345', spaceId: '/a', spacePath: '/a' }],
      },
    })
    if (result.kind === 'ok') expect(result.state.tabs[0]).not.toHaveProperty('agent')
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
  })

  it('fills in space ids from the path, with #n for a later space at the same path', () => {
    fs.writeFileSync(
      file,
      '{"version":1,"spaces":[{"path":"/a"},{"path":"/b"},{"path":"/a"}],"tabs":[{"id":"t1","spacePath":"/a"},{"id":"t2","spacePath":"/b"}]}',
    )
    const result = loadState(file)
    expect(result).toEqual({
      kind: 'ok',
      state: {
        version: 1,
        spaces: [
          { id: '/a', path: '/a' },
          { id: '/b', path: '/b' },
          { id: '/a#2', path: '/a' },
        ],
        tabs: [
          { id: 't1', spaceId: '/a', spacePath: '/a' },
          { id: 't2', spaceId: '/b', spacePath: '/b' },
        ],
      },
    })
  })

  it('keeps the ids a file already has, and fills in the rest around them', () => {
    fs.writeFileSync(
      file,
      '{"version":1,"spaces":[{"id":"/a#2","path":"/a"},{"path":"/a"}],"tabs":[{"id":"t1","spaceId":"/a#2","spacePath":"/a"}]}',
    )
    const result = loadState(file)
    expect(result.kind === 'ok' && result.state.spaces).toEqual([
      { id: '/a#2', path: '/a' },
      { id: '/a', path: '/a' },
    ])
    expect(result.kind === 'ok' && result.state.tabs).toEqual([{ id: 't1', spaceId: '/a#2', spacePath: '/a' }])
  })

  it('sets aside a version-1 file whose space id or tab spaceId is not a string', () => {
    fs.writeFileSync(file, '{"version":1,"spaces":[{"id":3,"path":"/a"}],"tabs":[]}')
    expect(loadState(file)).toEqual({ kind: 'ok', state: { version: 1, spaces: [], tabs: [] } })
    expect(fs.readdirSync(dir).filter((name) => /^state\.json\.corrupt-\d+$/.test(name))).toHaveLength(1)
  })

  it('round-trips a Claude tab with its agent and session id', () => {
    const state: StateV1 = {
      version: 1,
      spaces: [{ id: '/a', path: '/a' }],
      tabs: [{ id: 'abc12345', spaceId: '/a', spacePath: '/a', agent: 'claude', agentSessionId: '6f1c2b1e-0000-4000-8000-000000000001' }],
    }
    saveState(file, state)
    expect(loadState(file)).toEqual({ kind: 'ok', state })
  })

  it('loads a version-1 file written before labels, with no label set', () => {
    const bytes = '{"version":1,"spaces":[{"path":"/a"}],"tabs":[{"id":"abc12345","spacePath":"/a","agent":"claude"}]}'
    fs.writeFileSync(file, bytes)
    const result = loadState(file)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.state.tabs[0]).not.toHaveProperty('label')
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
  })

  it('round-trips a tab with its label', () => {
    const state: StateV1 = {
      version: 1,
      spaces: [{ id: '/a', path: '/a' }],
      tabs: [{ id: 'abc12345', spaceId: '/a', spacePath: '/a', agent: 'claude', agentSessionId: 'sess-1', label: 'api fix' }],
    }
    saveState(file, state)
    expect(loadState(file)).toEqual({ kind: 'ok', state })
  })

  it('round-trips a saved state and leaves no tmp file behind', () => {
    const state: StateV1 = {
      version: 1,
      spaces: [
        { id: '/a', path: '/a' },
        { id: '/b', path: '/b' },
        { id: '/a#2', path: '/a' },
      ],
      tabs: [
        { id: 'abc12345', spaceId: '/b', spacePath: '/b' },
        { id: 'def67890', spaceId: '/a#2', spacePath: '/a' },
      ],
    }
    saveState(file, state)
    expect(loadState(file)).toEqual({ kind: 'ok', state })
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })
})
