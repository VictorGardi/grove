import { describe, expect, it } from 'vitest'
import { stripControls } from './controlChars'

describe('stripControls', () => {
  it('removes ESC so a pasted end-of-paste marker is inert', () => {
    expect(stripControls('a\x1b[201~rm -rf ~\n')).toBe('a[201~rm -rf ~\n')
  })

  it('removes C0 and C1 controls but keeps newline, tab and text', () => {
    expect(stripControls('a\x00b\x07c\x9bd\x7fe\tf\ng ünï')).toBe('abcde\tf\ng ünï')
  })
})
