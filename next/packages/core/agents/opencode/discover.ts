import fs from 'node:fs'

export type Fetch = (input: URL, init?: RequestInit) => Promise<Response>

// Finds the OpenCode session an agent started by hand is running. The shared service lists every session with the
// folder it runs in (`location.directory`) and when it was created (`time.created`, ms). The newest session in
// `cwd` created at or after `since`, and not already `exclude`d (claimed by another tab), is the one: the earliest, as
// for Copilot, since the tab that was found first is the one whose session shows first. Undefined while there is none, or when the service cannot be read:
// the caller asks again on its next tick.
export async function findOpenCodeSession(input: {
  serviceFile: string
  cwd: string
  since: number
  exclude?: ReadonlySet<string>
  fetch?: Fetch
  readFile?: (file: string) => string
}): Promise<string | undefined> {
  const fetchFn: Fetch = input.fetch ?? ((url, init) => fetch(url, init))
  const readFile = input.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'))
  let service: { url?: unknown; password?: unknown }
  try {
    service = JSON.parse(readFile(input.serviceFile)) as { url?: unknown; password?: unknown }
  } catch {
    return undefined
  }
  if (typeof service.url !== 'string' || typeof service.password !== 'string') return undefined
  const headers = { authorization: 'Basic ' + Buffer.from(`opencode:${service.password}`).toString('base64') }
  let body: unknown
  try {
    const res = await fetchFn(new URL('/api/session', service.url), { headers, signal: AbortSignal.timeout(3000) })
    if (!res.ok) return undefined
    body = await res.json()
  } catch {
    return undefined
  }
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return undefined
  let best: { id: string; created: number } | undefined
  for (const session of data as Array<{ id?: unknown; location?: { directory?: unknown }; time?: { created?: unknown } }>) {
    if (typeof session.id !== 'string' || input.exclude?.has(session.id) || session.location?.directory !== input.cwd) continue
    const created = session.time?.created
    if (typeof created !== 'number' || created < input.since) continue
    if (best === undefined || created < best.created) best = { id: session.id, created }
  }
  return best?.id
}

