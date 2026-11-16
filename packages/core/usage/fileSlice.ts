import fs from 'node:fs'

export interface FileSlice {
  lines: string[]
  // Where the next slice starts: just after the last complete line read.
  next: number
  // True when the file holds more than what was read.
  more: boolean
}

// Reads the next slice of a file from `offset`: up to `chunkBytes`, cut after the last complete line. A line longer than the chunk
// reads on until it is whole; a half-written last line waits for the next pass (`next` stays where it was, no lines).
export async function sliceLines(file: string, offset: number, size: number, chunkBytes: number): Promise<FileSlice> {
  const handle = await fs.promises.open(file, 'r')
  try {
    let length = chunkBytes
    for (;;) {
      const buffer = Buffer.alloc(Math.min(length, size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      const end = buffer.subarray(0, bytesRead).lastIndexOf(10)
      if (end >= 0) return { lines: buffer.subarray(0, end + 1).toString('utf8').split('\n'), next: offset + end + 1, more: offset + end + 1 < size }
      if (offset + bytesRead >= size) return { lines: [], next: offset, more: false }
      length *= 2
    }
  } finally {
    await handle.close()
  }
}

// How many leading bytes tell a file apart from a rewritten one.
const HEAD_BYTES = 256

// The first bytes of a file (at most `length`, as hex), to notice that a file was replaced and not appended to.
export async function headOf(file: string, length = HEAD_BYTES): Promise<string> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(length, HEAD_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('hex')
  } finally {
    await handle.close()
  }
}

// True when a file still starts with the bytes it started with when it was last read up to `offset`: it was appended to, not rewritten.
export async function sameHead(file: string, head: string): Promise<boolean> {
  return (await headOf(file, head.length / 2)) === head
}
