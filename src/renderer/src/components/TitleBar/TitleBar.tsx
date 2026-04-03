import styles from './TitleBar.module.css'

interface TitleBarProps {
  platform: NodeJS.Platform | null
  workspaceName?: string | null
}

export function TitleBar({ platform, workspaceName }: TitleBarProps): React.JSX.Element {
  const isMac = platform === 'darwin'

  return (
    <div className={styles.titlebar} style={{ paddingLeft: isMac ? 80 : 16 }}>
      {workspaceName && (
        <span className={styles.workspaceName}>{workspaceName}</span>
      )}
    </div>
  )
}
