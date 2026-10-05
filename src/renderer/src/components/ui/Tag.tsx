import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './Tag.module.css'

// Classes that colour an element with palette entry `index` (tags.ts): 'fg' for text
// and icons, 'rail' for a left border down nested content.
export function tagClass(index: number | null, use: 'fg' | 'rail'): string | undefined {
  return index === null ? undefined : cx(s[`t${index}`], s[use])
}

export function Tag({ index, children }: { index: number | null; children: ReactNode }) {
  return (
    <span className={cx(index !== null && s[`t${index}`], s.chip)}>
      <span className={s.dot} />
      {children}
    </span>
  )
}
