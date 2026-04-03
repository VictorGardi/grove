import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { WorkspaceItem } from './WorkspaceItem'

export function WorkspaceList(): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)

  return (
    <div>
      {workspaces.map((workspace) => (
        <WorkspaceItem
          key={workspace.path}
          workspace={workspace}
          isActive={workspace.path === activeWorkspacePath}
          onClick={() => setActiveWorkspace(workspace.path)}
        />
      ))}

      <button
        onClick={addWorkspace}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 16px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-lo)',
          fontFamily: 'var(--font-ui)',
          fontSize: '12px',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'color var(--transition-fast)'
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-lo)'
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ color: 'currentColor', flexShrink: 0 }}
        >
          <path
            d="M8 3V13M3 8H13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Add workspace
      </button>
    </div>
  )
}
