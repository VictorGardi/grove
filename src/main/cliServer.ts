import fs from 'node:fs'
import net from 'node:net'
import { PROTOCOL, type CliReply, type CliSession, type TurnResult } from '@shared/cli'
import type { Session } from '@shared/types'
import type { Core } from '../core/core'
import { resolveSessionRef } from '../core/cliOps'

export interface CliServerOptions {
  socketPath: string
  raise(): void // shows and focuses the window (used by `focus`)
}

const fail = (id: string, code: string, message: string): CliReply => ({ id, ok: false, error: { code, message } })

const MESSAGES: Record<string, string> = {
  'not-found': 'no such session, or the folder is not a directory',
  'no-feature': 'no such feature in that project',
  'no-source': 'that agent is not available',
  ambiguous: 'more than one session matches',
  timeout: 'timed out waiting for the session',
  'no-status': 'a terminal session has no status to wait on',
  gone: 'the session has ended and cannot be resumed',
  'not-ready': 'the resumed session did not draw its prompt in time',
}

const failFrom = (id: string, code: string): CliReply => fail(id, code, MESSAGES[code] ?? code)

function toCli(core: Core, s: Session): CliSession {
  const project = core.getSlices().projects.find((p) => p.id === s.projectId)
  return {
    id: s.id,
    kind: s.kind,
    label: s.label,
    status: s.status ?? null,
    waitingFor: s.waitingFor ?? null,
    lastStatus: s.lastStatus,
    project: project?.name ?? '',
    cwd: s.cwd ?? project?.path ?? '',
    feature: s.feature,
  }
}

const listSessions = (core: Core, all: boolean): CliSession[] =>
  core.getSlices().sessions.filter((s) => all || s.lastStatus === 'running').map((s) => toCli(core, s))

const DEFAULT_TIMEOUT_S = 600

const timeoutMs = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : DEFAULT_TIMEOUT_S) * 1000

// The turn a send or create started (`wait`): the action already happened, so a timeout names the session.
async function waitAfter(core: Core, id: string, params: Record<string, unknown>, sessionId: string): Promise<CliReply | TurnResult> {
  const turn = await core.waitTurn(sessionId, { expectStart: true, timeoutMs: timeoutMs(params.timeoutS) })
  if (turn.ok) return turn.data
  return fail(id, turn.error, `${MESSAGES[turn.error] ?? turn.error} (session ${sessionId})`)
}

const KINDS: string[] = ['opencode', 'claude', 'terminal']
const optString = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

// The size of a session nobody is looking at; attaching resizes it.
const COLS = 120
const ROWS = 40

async function dispatch(core: Core, raise: () => void, line: string): Promise<CliReply> {
  let req: { v?: unknown; id?: unknown; method?: unknown; params?: unknown }
  try {
    req = JSON.parse(line)
  } catch {
    return fail('', 'bad-request', 'not a JSON line')
  }
  const id = typeof req.id === 'string' ? req.id : ''
  if (req.v !== PROTOCOL) return fail(id, 'bad-version', `this app speaks protocol ${PROTOCOL}`)
  const params = (req.params ?? {}) as Record<string, unknown>
  switch (req.method) {
    case 'sessions.list':
      return { id, ok: true, data: listSessions(core, params.all === true) }
    case 'sessions.create': {
      const { kind, cwd } = params
      if (typeof kind !== 'string' || !KINDS.includes(kind) || typeof cwd !== 'string' || !cwd) {
        return fail(id, 'bad-params', 'kind and cwd are required')
      }
      const res = await core.commands.sessionCreate({
        kind: kind as Session['kind'], cwd, prompt: optString(params.prompt), label: optString(params.label),
        feature: optString(params.feature), cols: COLS, rows: ROWS,
      })
      if (!res.ok) return failFrom(id, res.error)
      const created = toCli(core, res.data)
      if (params.wait !== true) return { id, ok: true, data: created }
      const turn = await waitAfter(core, id, params, res.data.id)
      return 'ok' in turn ? turn : { id, ok: true, data: { ...created, turn } }
    }
    case 'sessions.send': {
      const { ref, text } = params
      if (typeof ref !== 'string' || typeof text !== 'string' || !ref) return fail(id, 'bad-params', 'ref and text are required')
      const found = resolveSessionRef(core.getSlices().sessions, ref)
      if (!found.ok) return failFrom(id, found.error)
      const res = await core.commands.sendToSession({ id: found.data.id, text, submit: params.submit !== false })
      if (!res.ok) return failFrom(id, res.error)
      if (params.wait !== true) return { id, ok: true, data: res.data }
      const turn = await waitAfter(core, id, params, found.data.id)
      return 'ok' in turn ? turn : { id, ok: true, data: { ...res.data, turn } }
    }
    case 'sessions.wait': {
      const { ref } = params
      if (typeof ref !== 'string' || !ref) return fail(id, 'bad-params', 'ref is required')
      const found = resolveSessionRef(core.getSlices().sessions, ref)
      if (!found.ok) return failFrom(id, found.error)
      const turn = await core.waitTurn(found.data.id, { expectStart: false, timeoutMs: timeoutMs(params.timeoutS) })
      return turn.ok ? { id, ok: true, data: { id: found.data.id, ...turn.data } } : failFrom(id, turn.error)
    }
    case 'sessions.focus':
    case 'sessions.kill': {
      const { ref } = params
      if (typeof ref !== 'string' || !ref) return fail(id, 'bad-params', 'ref is required')
      const found = resolveSessionRef(core.getSlices().sessions, ref)
      if (!found.ok) return failFrom(id, found.error)
      const res = req.method === 'sessions.kill'
        ? await core.commands.sessionKill({ id: found.data.id })
        : await core.commands.uiSet({ focusedSessionId: found.data.id })
      if (!res.ok) return failFrom(id, res.error)
      if (req.method === 'sessions.focus') raise()
      return { id, ok: true, data: { id: found.data.id } }
    }
    case 'sessions.read': {
      const { ref, lines } = params
      if (typeof ref !== 'string' || !ref || typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1) {
        return fail(id, 'bad-params', 'ref and lines are required')
      }
      const found = resolveSessionRef(core.getSlices().sessions, ref)
      if (!found.ok) return failFrom(id, found.error)
      const res = await core.commands.sessionRead({ id: found.data.id, lines })
      return res.ok ? { id, ok: true, data: res.data } : failFrom(id, res.error)
    }
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
      void dispatch(core, o.raise, line).then((reply) => conn.end(JSON.stringify(reply) + '\n'))
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
