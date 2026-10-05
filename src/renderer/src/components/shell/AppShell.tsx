import type { CSSProperties, ReactNode } from 'react'
import s from './AppShell.module.css'

export function AppShell({ topBar, banners, sidebar, content, sidebarWidth }: {
  topBar: ReactNode
  banners?: ReactNode
  sidebar: ReactNode
  content: ReactNode
  sidebarWidth: number
}) {
  return (
    <div className={s.shell} style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}>
      {topBar}
      {banners}
      <div className={s.body}>
        <aside className={s.sidebar}>{sidebar}</aside>
        <main className={s.content}>{content}</main>
      </div>
    </div>
  )
}
