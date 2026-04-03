export function AppWordmark(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        height: '40px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border-dim)'
      }}
    >
      {/* Tree/seedling icon */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
      >
        <path
          d="M8 14V8M8 8C8 5.5 6 3 3 3C3 6 5 8 8 8ZM8 8C8 5.5 10 3 13 3C13 6 11 8 8 8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 14H10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '15px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em'
        }}
      >
        Grove
      </span>
    </div>
  )
}
