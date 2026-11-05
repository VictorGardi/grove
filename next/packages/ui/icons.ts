// Icon shapes ported from the old app's src/renderer/src/components/ui/Icon.tsx (Lucide-shaped paths, ISC licence).
// The size and the stroke width are not set here: the .icon class in styles.css takes them from --icon-size and
// --icon-stroke, so every icon in the window follows the tokens.

export const ICON_NAMES = ['search', 'sidebar', 'plus', 'grid', 'x', 'terminal', 'worktree'] as const

export type IconName = (typeof ICON_NAMES)[number]

const SHAPES: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />',
  plus: '<path d="M5 12h14" /><path d="M12 5v14" />',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />',
  x: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  terminal: '<path d="m4 17 6-6-6-6" /><path d="M12 19h8" />',
  worktree:
    '<path d="M2 18V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v1" /><circle cx="13" cy="15" r="2" /><circle cx="20" cy="20" r="2" /><path d="M13 21v-4M20 18v-1a2 2 0 0 0-2-2h-3" />',
}

// The SVG markup for an icon, to put in innerHTML. Decorative: the control that holds it carries the label.
export function iconSvg(name: IconName): string {
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name]}</svg>`
}
