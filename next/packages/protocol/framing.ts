import { StringDecoder } from 'node:string_decoder'

export function encodeLine(message: unknown): string {
  return JSON.stringify(message) + '\n'
}

export function createLineDecoder(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  return (chunk) => {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (line.length > 0) onLine(line)
      newline = pending.indexOf('\n')
    }
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function b64ToBytes(data: string): Buffer {
  return Buffer.from(data, 'base64')
}
