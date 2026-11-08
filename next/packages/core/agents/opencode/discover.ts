import fs from 'node:fs'
import path from 'node:path'

// The shared OpenCode service's registration file. Holds a password: never log it, never push it.
export function serviceFilePath(env: NodeJS.ProcessEnv, home: string): string {
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'opencode', 'service.json')
}

// What the service file offers the API callers: the base URL and the Basic-auth password. Undefined while the file
// is unreadable or either field is not a string, so a caller polls again later rather than guessing.
export interface OpenCodeService {
  url: string
  password: string
}

export function readOpenCodeService(input: { serviceFile: string; readFile?: (file: string) => string }): OpenCodeService | undefined {
  const readFile = input.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'))
  let service: { url?: unknown; password?: unknown }
  try {
    service = JSON.parse(readFile(input.serviceFile)) as { url?: unknown; password?: unknown }
  } catch {
    return undefined
  }
  if (typeof service.url !== 'string' || typeof service.password !== 'string') return undefined
  return { url: service.url, password: service.password }
}

// The Basic-auth header the shared service asks for on every request.
export function openCodeAuth(service: OpenCodeService): { authorization: string } {
  return { authorization: 'Basic ' + Buffer.from(`opencode:${service.password}`).toString('base64') }
}

export type Fetch = (input: URL, init?: RequestInit) => Promise<Response>

// Finds the OpenCode session an agent started by hand is running. The shared service lists every session with the
// folder it runs in (`location.directory`) and when it was created (`time.created`, ms). The one session in `cwd`
// created at or after `since` and not already `exclude`d (claimed by another tab) is it. With more than one
// eligible candidate there is no way to tell they were hand-started apart, so the discovery is undefined too: an
// ambiguous hand-started tab is never adopted and never credited with another session's usage, rather than guessed.
// Undefined while there is none, or when the service cannot be read: the caller asks again on its next tick.
export async function findOpenCodeSession(input: {
  serviceFile: string
  cwd: string
  since: number
  exclude?: ReadonlySet<string>
  fetch?: Fetch
  readFile?: (file: string) => string
}): Promise<string | undefined> {
  const fetchFn: Fetch = input.fetch ?? ((url, init) => fetch(url, init))
  const service = readOpenCodeService(input)
  if (service === undefined) return undefined
  let body: unknown
  try {
    const res = await fetchFn(new URL('/api/session', service.url), {
      headers: openCodeAuth(service),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return undefined
    body = await res.json()
  } catch {
    return undefined
  }
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return undefined
  let found: string | undefined
  for (const session of data as Array<{ id?: unknown; location?: { directory?: unknown }; time?: { created?: unknown } }>) {
    if (typeof session.id !== 'string' || input.exclude?.has(session.id) || session.location?.directory !== input.cwd) continue
    const created = session.time?.created
    if (typeof created !== 'number' || created < input.since) continue
    // A second eligible candidate makes the whole discovery ambiguous, taking a found one with it.
    if (found !== undefined) return undefined
    found = session.id
  }
  return found
}
