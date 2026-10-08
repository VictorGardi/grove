import type { FileTarget, ViewerTarget } from '@shared/types'

export interface HiddenRenderedViewer { sessionId: string; target: FileTarget }

export type SessionDiffShortcutAction =
  | { kind: 'hide-rendered'; hidden: HiddenRenderedViewer }
  | { kind: 'restore-rendered'; target: FileTarget }
  | { kind: 'toggle-diff' }

export function sessionDiffShortcut(
  viewer: ViewerTarget | null,
  hidden: HiddenRenderedViewer | null,
): SessionDiffShortcutAction {
  if (viewer?.kind === 'file' && viewer.fromDiff) {
    return { kind: 'hide-rendered', hidden: { sessionId: viewer.fromDiff, target: viewer } }
  }
  if (!viewer && hidden) return { kind: 'restore-rendered', target: hidden.target }
  return { kind: 'toggle-diff' }
}
