import { describe, expect, it } from 'vitest'
import { pasteText } from './paste.ts'

describe('pasteText', () => {
  it('sends the text as one bracketed paste, then Enter when submitting', async () => {
    const writes: string[] = []
    await pasteText(async (data) => void writes.push(data), 'hi\nthere', true)
    expect(writes).toEqual(['\x1b[200~hi\nthere\x1b[201~', '\r'])
  })

  it('leaves Enter out when not submitting', async () => {
    const writes: string[] = []
    await pasteText(async (data) => void writes.push(data), 'hi', false)
    expect(writes).toEqual(['\x1b[200~hi\x1b[201~'])
  })

  it('strips control characters, so a pasted end marker cannot end the paste early', async () => {
    const writes: string[] = []
    await pasteText(async (data) => void writes.push(data), 'a\x1b[201~\x07b\tc\r', false)
    // The ESC is stripped, leaving the printable "[201~" behind; tab and newline stay.
    expect(writes).toEqual(['\x1b[200~a[201~b\tc\x1b[201~'])
  })
})
