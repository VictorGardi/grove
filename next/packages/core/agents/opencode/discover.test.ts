import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findOpenCodeSession } from './discover.ts'

const CWD = '/work/app'

function serviceFile(dir: string): string {
  const file = path.join(dir, 'service.json')
  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:1234', password: 'secret' }))
  return file
}

function fakeFetch(data: unknown[]) {
  const calls: Array<{ url: string; auth: string | undefined }> = []
  const fetch = async (input: URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), auth: (init?.headers as Record<string, string>).authorization })
    return new Response(JSON.stringify({ data }), { status: 200 })
  }
  return { fetch, calls }
}

describe('findOpenCodeSession', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-oc-discover-'))

  it('picks the newest session in the folder created since the tab was found', async () => {
    const { fetch, calls } = fakeFetch([
      { id: 'ses_old', location: { directory: CWD }, time: { created: 100 } },
      { id: 'ses_other', location: { directory: '/elsewhere' }, time: { created: 900 } },
      { id: 'ses_new', location: { directory: CWD }, time: { created: 800 } },
      { id: 'ses_early', location: { directory: CWD }, time: { created: 50 } },
    ])
    const id = await findOpenCodeSession({ serviceFile: serviceFile(dir), cwd: CWD, since: 500, fetch })
    expect(id).toBe('ses_new')
    expect(calls[0].url).toBe('http://127.0.0.1:1234/api/session')
    expect(calls[0].auth).toBe('Basic ' + Buffer.from('opencode:secret').toString('base64'))
  })

  it('is undefined while no session matches, or when the service cannot be reached', async () => {
    const none = await findOpenCodeSession({ serviceFile: serviceFile(dir), cwd: CWD, since: 0, fetch: fakeFetch([]).fetch })
    expect(none).toBeUndefined()
    const down = await findOpenCodeSession({
      serviceFile: serviceFile(dir),
      cwd: CWD,
      since: 0,
      fetch: async () => {
        throw new Error('refused')
      },
    })
    expect(down).toBeUndefined()
    const noFile = await findOpenCodeSession({ serviceFile: path.join(dir, 'missing.json'), cwd: CWD, since: 0 })
    expect(noFile).toBeUndefined()
  })
})
