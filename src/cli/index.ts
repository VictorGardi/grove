import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PROTOCOL, type CliMethods, type CliReply } from '@shared/cli'
import { parseCommand, UsageError, type Command } from './args'
import { request } from './client'
import { exitCode, formatError, formatLs, formatNew } from './output'

const call = (socket: string, method: keyof CliMethods, params: unknown): Promise<CliReply> =>
  request(socket, { v: PROTOCOL, id: randomUUID(), method, params })

const text = (arg: string | undefined) => (arg === '-' ? fs.readFileSync(0, 'utf8') : arg)

async function run(cmd: Command, socket: string): Promise<CliReply & { print?: string }> {
  if (cmd.cmd === 'ls') {
    const reply = await call(socket, 'sessions.list', { all: cmd.all })
    return reply.ok ? { ...reply, print: formatLs(reply.data as CliMethods['sessions.list']['data'], process.env.GROVE_SESSION_ID ?? null, cmd.json) } : reply
  }
  const reply = await call(socket, 'sessions.create', {
    kind: cmd.kind, cwd: path.resolve(cmd.cwd ?? process.cwd()), prompt: text(cmd.prompt), label: cmd.label, feature: cmd.link,
  })
  return reply.ok ? { ...reply, print: formatNew(reply.data as CliMethods['sessions.create']['data'], cmd.json) } : reply
}

async function main(): Promise<number> {
  const cmd = parseCommand(process.argv.slice(2))
  if (cmd instanceof UsageError) {
    console.error(cmd.message)
    return 2
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
  console.log(reply.print)
  return 0
}

main().then((code) => process.exit(code))
