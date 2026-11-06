// Icon shapes ported from the old app's src/renderer/src/components/ui/Icon.tsx (Lucide-shaped paths, ISC licence).
// The size and the stroke width are not set here: the .icon class in styles.css takes them from --icon-size and
// --icon-stroke, so every icon in the window follows the tokens.

export const ICON_NAMES = ['search', 'sidebar', 'plus', 'grid', 'x', 'terminal', 'worktree', 'branch', 'edit', 'notes', 'diff', 'check', 'chevron', 'send'] as const

export type IconName = (typeof ICON_NAMES)[number]

const SHAPES: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />',
  plus: '<path d="M5 12h14" /><path d="M12 5v14" />',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />',
  x: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  terminal: '<path d="m4 17 6-6-6-6" /><path d="M12 19h8" />',
  branch: '<line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />',
  edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />',
  notes: '<path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />',
  diff: '<circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5v4a4 4 0 0 0 4 4h5.5" /><path d="M13 13.5 15.5 16 13 18.5" />',
  check: '<path d="m5 12 5 5L20 7" />',
  chevron: '<path d="m6 9 6 6 6-6" />',
  send: '<path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />',
  worktree:
    '<path d="M2 18V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v1" /><circle cx="13" cy="15" r="2" /><circle cx="20" cy="20" r="2" /><path d="M13 21v-4M20 18v-1a2 2 0 0 0-2-2h-3" />',
}

// The SVG markup for an icon, to put in innerHTML. Decorative: the control that holds it carries the label.
export function iconSvg(name: IconName): string {
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name]}</svg>`
}

// Solid agent glyphs (Claude Code, OpenCode and Copilot CLI marks, one colour: the text colour of the element that holds them).
const AGENT_SHAPES = {
  claude:
    '<path fill-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />',
  opencode: '<path fill-rule="evenodd" d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />',
  copilot:
    '<path fill-rule="evenodd" d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z" />',
}

export type AgentIconName = keyof typeof AGENT_SHAPES

export function agentIconSvg(name: AgentIconName): string {
  return `<svg class="icon icon-agent" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${AGENT_SHAPES[name]}</svg>`
}
