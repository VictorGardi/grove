import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { paneStable, resolveProject, resolveSessionRef } from './cliOps'
import { newSession } from './sessions'

const NOW = new Date('2026-10-07T10:00:00Z')
const sess = (id: string, label = id) => ({ ...newSession({ projectId: 'p', kind: 'terminal', now: NOW, id, agentSessionId: null }), label })

describe('resolveSessionRef', () => {
  const list = [sess('abcd1111', 'one'), sess('abcd2222', 'two'), sess('ffff3333', 'dup'), sess('eeee4444', 'dup')]

  it('matches a full id, a unique prefix and an exact label', () => {
    expect(resolveSessionRef(list, 'abcd1111')).toMatchObject({ ok: true, data: { id: 'abcd1111' } })
    expect(resolveSessionRef(list, 'abcd2')).toMatchObject({ ok: true, data: { id: 'abcd2222' } })
    expect(resolveSessionRef(list, 'one')).toMatchObject({ ok: true, data: { id: 'abcd1111' } })
  })

  it('does not match a prefix shorter than 4', () => {
    expect(resolveSessionRef(list, 'abc')).toEqual({ ok: false, error: 'not-found' })
  })

  it('reports ambiguous prefixes and labels, and unknown refs', () => {
    expect(resolveSessionRef(list, 'abcd')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveSessionRef(list, 'dup')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveSessionRef(list, 'nope')).toEqual({ ok: false, error: 'not-found' })
  })

  it('prefers an id match over a label', () => {
    const l = [sess('wxyz1111', 'x'), sess('other111', 'wxyz1111')]
    expect(resolveSessionRef(l, 'wxyz1111')).toMatchObject({ ok: true, data: { id: 'wxyz1111' } })
  })
})

describe('resolveProject', () => {
  const proj = (id: string, p: string): Project => ({ id, name: id, path: p })
  const projects = [proj('a', '/zz/repo'), proj('b', '/zz/repo/packages/x')]
  const noGit = async () => null

  it('picks the longest containing project, for a subfolder too', async () => {
    expect(await resolveProject(projects, '/zz/repo/packages/x/src', noGit)).toMatchObject({ project: { id: 'b' }, added: false })
    expect(await resolveProject(projects, '/zz/repo/docs', noGit)).toMatchObject({ project: { id: 'a' }, added: false })
  })

  it('does not treat a sibling with a shared name prefix as contained', async () => {
    const r = await resolveProject(projects, '/zz/repo2', noGit)
    expect(r.added).toBe(true)
  })

  it('registers the git top level when no project contains the folder', async () => {
    const r = await resolveProject(projects, '/yy/other/sub', async () => '/yy/other')
    expect(r).toMatchObject({ added: true, project: { name: 'other', path: '/yy/other' } })
  })

  it('registers the folder itself outside git', async () => {
    const r = await resolveProject([], '/yy/plain', noGit)
    expect(r).toMatchObject({ added: true, project: { name: 'plain', path: '/yy/plain' } })
  })
})

describe('paneStable', () => {
  const sleep = async () => {}

  it('is true once two captures match', async () => {
    const caps = ['a', 'ab', 'abc', 'abc']
    expect(await paneStable(async () => caps.shift() ?? 'abc', { intervalMs: 10, timeoutMs: 1000, sleep })).toBe(true)
  })

  it('gives up after the timeout', async () => {
    let n = 0
    expect(await paneStable(async () => String(n++), { intervalMs: 10, timeoutMs: 50, sleep })).toBe(false)
  })
})
