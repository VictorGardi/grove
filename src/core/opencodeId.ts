import { randomBytes } from 'node:crypto'

// Port of spikes/opencode/gen-session-id.js: OpenCode's descending id format,
// where newer ids sort first (OC:packages/schema/src/identifier.ts).
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function mintSessionId(now = Date.now()): string {
  const value = ~(BigInt(now) * 0x1000n + 1n)
  const time = Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  ).join('')
  const rand = Array.from(randomBytes(14), (b) => CHARS[b % 62]).join('')
  return 'ses_' + time + rand
}
