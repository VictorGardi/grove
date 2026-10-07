import fs from 'node:fs'
import net from 'node:net'
import { PROTOCOL, type CliReply, type CliSession } from '@shared/cli'
import type { Core } from '../core/core'

export interface CliServerOptions {
  socketPath: string
  raise(): void // shows and focuses the window (used by `focus`, slice 5)
}

const fail = (id: string, code: string, message: string): CliReply => ({ id, ok: false, error: { code, message } })

function listSessions(core: Core, all: boolean): CliSession[] {
  const { sessions, projects } = core.getSlices()
  return sessions
    .filter((s) => all || s.lastStatus === 'running')
    .map((s) => {
      const project = projects.find((p) => p.id === s.projectId)
      return {
        id: s.id,
        kind: s.kind,
        label: s.label,
        status: s.status ?? null,
        waitingFor: s.waitingFor ?? null,
        lastStatus: s.lastStatus,
        project: project?.name ?? '',
        cwd: project?.path ?? '',
        feature: s.feature,
      }
    })
}

async function dispatch(core: Core, line: string): Promise<CliReply> {
  let req: { v?: unknown; id?: unknown; method?: unknown; params?: unknown }
  try {
    req = JSON.parse(line)
  } catch {
    return fail('', 'bad-request', 'not a JSON line')
  }
  const id = typeof req.id === 'string' ? req.id : ''
  if (req.v !== PROTOCOL) return fail(id, 'bad-version', `this app speaks protocol ${PROTOCOL}`)
  const params = (req.params ?? {}) as { all?: unknown }
  switch (req.method) {
    case 'sessions.list':
      return { id, ok: true, data: listSessions(core, params.all === true) }
    default:
      return fail(id, 'bad-method', `unknown method: ${String(req.method)}`)
  }
}

// Same-user only: mode 0600 on the socket (ADR 0027). A stale file from a crash is replaced; the single-instance lock makes that safe.
export function startCliServer(core: Core, o: CliServerOptions): Promise<{ close(): void }> {
  fs.rmSync(o.socketPath, { force: true })
  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('error', () => {})
    conn.on('data', (d: string) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      buf = ''
      void dispatch(core, line).then((reply) => conn.end(JSON.stringify(reply) + '\n'))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.socketPath, () => {
      fs.chmodSync(o.socketPath, 0o600)
      resolve({
        close() {
          server.close()
          fs.rmSync(o.socketPath, { force: true })
        },
      })
    })
  })
}
