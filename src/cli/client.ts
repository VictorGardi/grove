import net from 'node:net'
import type { CliReply, CliRequest } from '@shared/cli'

const NOT_RUNNING: Record<string, true> = { ENOENT: true, ECONNREFUSED: true }

// One request per connection; the reply is the first line. A missing or dead socket means the app isn't running.
export function request(socketPath: string, req: CliRequest): Promise<CliReply> {
  return new Promise((resolve) => {
    const fail = (code: string, message: string) => resolve({ id: req.id, ok: false, error: { code, message } })
    const conn = net.connect(socketPath)
    let buf = ''
    let done = false
    conn.setEncoding('utf8')
    conn.on('connect', () => conn.write(JSON.stringify(req) + '\n'))
    conn.on('data', (d: string) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0 || done) return
      done = true
      conn.end()
      try {
        resolve(JSON.parse(buf.slice(0, nl)) as CliReply)
      } catch {
        fail('bad-reply', 'the app sent an unreadable reply')
      }
    })
    conn.on('error', (e: NodeJS.ErrnoException) => {
      if (done) return
      done = true
      if (e.code && NOT_RUNNING[e.code]) fail('not-running', 'the Grove app is not running')
      else fail('connection', e.message)
    })
    conn.on('close', () => {
      if (done) return
      done = true
      fail('connection', 'the app closed the connection without a reply')
    })
  })
}
