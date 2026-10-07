import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PROTOCOL, type CliMethods, type CliReply, type TurnResult } from '@shared/cli'
import { parseCommand, UsageError, type Command } from './args'
import { request } from './client'
import { exitCode, formatError, formatLs, formatNew, formatRead, turnExit } from './output'

const call = (socket: string, method: keyof CliMethods, params: unknown): Promise<CliReply> =>
  request(socket, { v: PROTOCOL, id: randomUUID(), method, params })

// The exit code of a reply that carries a waited-for turn.
const turnOf = (reply: CliReply & { ok: true }): number => {
  const turn = (reply.data as { turn?: TurnResult }).turn
  return turn ? turnExit(turn) : 0
}

const text = (arg: string | undefined) => (arg === '-' ? fs.readFileSync(0, 'utf8') : arg)

async function run(cmd: Exclude<Command, { cmd: 'skill' }>, socket: string): Promise<CliReply & { print?: string; exit?: number }> {
  if (cmd.cmd === 'ls') {
    const reply = await call(socket, 'sessions.list', { all: cmd.all })
    return reply.ok ? { ...reply, print: formatLs(reply.data as CliMethods['sessions.list']['data'], process.env.GROVE_SESSION_ID ?? null, cmd.json) } : reply
  }
  if (cmd.cmd === 'send') {
    const reply = await call(socket, 'sessions.send', { ref: cmd.ref, text: text(cmd.text) ?? '', submit: cmd.submit, wait: cmd.wait, timeoutS: cmd.timeoutS })
    return reply.ok ? { ...reply, print: undefined, exit: turnOf(reply) } : reply
  }
  if (cmd.cmd === 'focus' || cmd.cmd === 'kill') {
    const reply = await call(socket, cmd.cmd === 'focus' ? 'sessions.focus' : 'sessions.kill', { ref: cmd.ref })
    return reply.ok ? { ...reply, print: undefined } : reply
  }
  if (cmd.cmd === 'wait') {
    const reply = await call(socket, 'sessions.wait', { ref: cmd.ref, timeoutS: cmd.timeoutS })
    return reply.ok ? { ...reply, print: undefined, exit: turnExit(reply.data as TurnResult) } : reply
  }
  if (cmd.cmd === 'read') {
    const reply = await call(socket, 'sessions.read', { ref: cmd.ref, lines: cmd.lines })
    return reply.ok ? { ...reply, print: formatRead((reply.data as CliMethods['sessions.read']['data']).text) } : reply
  }
  const reply = await call(socket, 'sessions.create', {
    kind: cmd.kind, cwd: path.resolve(cmd.cwd ?? process.cwd()), prompt: text(cmd.prompt), label: cmd.label, feature: cmd.link,
    wait: cmd.wait, timeoutS: cmd.timeoutS,
  })
  return reply.ok ? { ...reply, print: formatNew(reply.data as CliMethods['sessions.create']['data'], cmd.json), exit: turnOf(reply) } : reply
}

async function main(): Promise<number> {
  const cmd = parseCommand(process.argv.slice(2))
  if (cmd instanceof UsageError) {
    console.error(cmd.message)
    return 2
  }
  if (cmd.cmd === 'skill') {
    // The CLI bundle is <app>/out/main/cli.js (ADR 0028); the skill ships in <app>/resources.
    process.stdout.write(fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'skills', 'grove', 'SKILL.md'), 'utf8'))
    return 0
  }
  const socket = process.env.GROVE_SOCKET
  if (!socket) {
    console.error('grove: GROVE_SOCKET is not set')
    return 2
  }
  const reply = await run(cmd, socket)
  if (!reply.ok) {
    console.error(formatError(reply.error))
    return exitCode(reply)
  }
  if (reply.print !== undefined) console.log(reply.print)
  return reply.exit ?? 0
}

main().then((code) => process.exit(code))
