import { randomUUID } from 'node:crypto'
import { PROTOCOL, type CliSession } from '@shared/cli'
import { parseCommand, UsageError } from './args'
import { request } from './client'
import { exitCode, formatError, formatLs } from './output'

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
  const reply = await request(socket, { v: PROTOCOL, id: randomUUID(), method: 'sessions.list', params: { all: cmd.all } })
  if (!reply.ok) {
    console.error(formatError(reply.error))
    return exitCode(reply)
  }
  console.log(formatLs(reply.data as CliSession[], process.env.GROVE_SESSION_ID ?? null, cmd.json))
  return 0
}

main().then((code) => process.exit(code))
