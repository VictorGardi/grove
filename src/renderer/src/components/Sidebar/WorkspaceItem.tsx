import { useState } from 'react'
import type { WorkspaceInfo } from '@shared/types'
import { ContextMenu } from './ContextMenu'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useDataStore } from '../../stores/useDataStore'

interface WorkspaceItemProps {
  workspace: WorkspaceInfo
  isActive: boolean
  onClick: () => void
}

export function WorkspaceItem({ workspace, isActive, onClick }: WorkspaceItemProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace)
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const tasks = useDataStore((s) => s.tasks)

  // Only show badge for active workspace with doing tasks
  const isActiveWorkspace = workspace.path === activeWorkspacePath
  const doingCount = isActiveWorkspace ? tasks.filter((t) => t.status === 'doing').length : 0
  const showBadge = isActiveWorkspace && doingCount > 0

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleRemove(): void {
    if (window.confirm(`Remove "${workspace.name}" from Grove?`)) {
      removeWorkspace(workspace.path)
    }
    setContextMenu(null)
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Workspace: ${workspace.name}`}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={handleContextMenu}
        title={workspace.exists ? undefined : 'Directory not found'}
        style={{
          padding: '5px 12px',
          cursor: 'pointer',
          opacity: workspace.exists ? 1 : 0.4,
          background: isActive
            ? 'var(--bg-active)'
            : hovered
              ? 'var(--bg-hover)'
              : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'background var(--transition-fast), border-color var(--transition-fast)',
          outline: 'none'
        }}
      >
        {/* Name row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {/* Repo icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
          >
            <path
              d="M2 2.5C2 1.67 2.67 1 3.5 1H12.5C13.33 1 14 1.67 14 2.5V14L11 12.5L8 14L5 12.5L2 14V2.5Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M5.5 5H10.5M5.5 8H8.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>

          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '13px',
              color: 'var(--text-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {workspace.name}
          </span>

          {/* Task count badge — only active workspace with doing tasks */}
          {showBadge && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-lo)'
              }}
            >
              [{doingCount}]
            </span>
          )}
        </div>

        {/* Branch row */}
        {workspace.isGitRepo && workspace.branch && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '2px',
              paddingLeft: '26px'
            }}
          >
            {/* Branch icon */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ color: 'var(--text-lo)', flexShrink: 0 }}
            >
              <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M4 6V10C4 11.1 4.9 12 6 12H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M12 6V10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-lo)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {workspace.branch}
            </span>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          workspaceName={workspace.name}
          onRemove={handleRemove}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
