import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// How long to keep looking for the container bridge before giving up. `bridge100` is created by
// `container system start`, not at boot — measured 2m24s after login — so a session started in the
// first few minutes of the morning finds no bridge yet. Refusing on the first miss would reject
// every session for those minutes, which is why the design makes this a wait and not a refusal.
const ATTEMPTS = 30
const FIRST_DELAY_MS = 250
const MAX_DELAY_MS = 8000 // about 3½ minutes in total

// The only network grove ever asks about. A network created with `--subnet 10.99.0.0/24` has the
// gateway `10.99.0.1`, so `.1` is a coincidence of one host's subnet and not a rule: the address
// is discovered, never assumed (D6).
const NETWORK = 'default'

// An address a container could actually reach, on the other side of the bridge from the host.
// `0.0.0.0` is measured to put the service on the LAN, and a loopback address inside the container
// is the container itself — neither is a bind, so neither ends the wait.
function usable(gateway: unknown): gateway is string {
  return typeof gateway === 'string' && gateway !== '' && gateway !== '0.0.0.0' && gateway !== '*' && !gateway.startsWith('127.')
}

// Makes the host's shared OpenCode service reachable from inside a container, once (D6).
//
// Writes `{"hostname": "<container bridge>"}` into the service **config**
// (`$XDG_CONFIG_HOME/opencode/service.json`), never `0.0.0.0`. The service reads that file when it
// starts and binds the address there, and registers the resulting `url` in its own state file — so
// this changes where the service *will* listen, and what grove hands the container is the password
// it must authenticate with.
//
// Idempotent in the way the design asks: a config that already names a usable address spawns
// nothing at all. The registration file is never written — a second registration evicts the
// incumbent service, which is the failure D6 exists to prevent — and never read either; it is the
// host's, and grove only takes the password out of it elsewhere.
//
// Throws when the budget is spent, which the caller turns into `no-sandbox`. There is no fallback
// to a wildcard address: a service on the LAN is worse than no sandboxed session at all.
export async function ensureServiceReachable(o: {
  configFile: string
  container: string
  attempts?: number // tests; the real budget is ATTEMPTS
  firstDelayMs?: number
  maxDelayMs?: number
}): Promise<void> {
  if (usable(readConfig(o.configFile).hostname)) return // already bound; nothing to decide
  // Idempotent, and on a system already up it can still exit non-zero — so its status is not the
  // answer. Whether a gateway can be discovered is.
  await run(o.container, ['system', 'start'], 30_000)
  const attempts = o.attempts ?? ATTEMPTS
  let delay = o.firstDelayMs ?? FIRST_DELAY_MS
  for (let attempt = 0; attempt < attempts; attempt++) {
    const gateway = await gatewayOf(o.container)
    if (usable(gateway)) {
      writeConfig(o.configFile, gateway)
      return
    }
    if (attempt < attempts - 1) {
      await sleep(delay)
      delay = Math.min(delay * 2, o.maxDelayMs ?? MAX_DELAY_MS)
    }
  }
  throw new Error('no container bridge: `container network ls` never named a gateway')
}

// The host service's password, which the container needs or gets 401. Its registration is the one
// file grove reads and never writes. Undefined rather than a throw: a missing registration is not
// this function's failure to report.
export function servicePassword(registrationFile: string): string | undefined {
  try {
    const password = (JSON.parse(fs.readFileSync(registrationFile, 'utf8')) as { password?: unknown }).password
    return typeof password === 'string' && password !== '' ? password : undefined
  } catch {
    return undefined
  }
}

// The service writes its own `password` and `port` back into this file, so every other key has to
// survive the write — read-modify-write, never overwrite. Mode 0600 on create: the file holds a
// secret, and the human's own umask is not a security property.
function writeConfig(file: string, hostname: string): void {
  // The directory is normally opencode's own; grove does not assume it is there.
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...readConfig(file), hostname }, null, 2) + '\n', { mode: 0o600 })
}

function readConfig(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {} // absent or unreadable: grove is about to create it
  }
}

async function gatewayOf(container: string): Promise<string | undefined> {
  const out = await run(container, ['network', 'ls', '--format', 'json'], 15_000)
  try {
    const networks = JSON.parse(out ?? '') as { configuration?: { name?: string }; status?: { ipv4Gateway?: string } }[]
    return Array.isArray(networks) ? networks.find((n) => n?.configuration?.name === NETWORK)?.status?.ipv4Gateway : undefined
  } catch {
    return undefined // not JSON yet: the system is still coming up
  }
}

// Resolves with stdout whatever the exit status. Every caller here is a wait, not a verdict, so a
// failed call answers "nothing found yet" rather than throwing something the caller cannot act on.
function run(container: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(container, args, { timeout }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))