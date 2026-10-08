import { describe, expect, it } from 'vitest'
import type { ViewerTarget } from '@shared/types'
import { sessionDiffShortcut } from './sessionDiffShortcut'

const rendered: ViewerTarget = { kind: 'file', projectId: 'p', path: 'docs/design.md', hash: null, fromDiff: 's1' }
const diff: ViewerTarget = { kind: 'diff', sessionId: 's1' }
const standaloneFile: ViewerTarget = { kind: 'file', projectId: 'p', path: 'README.md', hash: null, fromDiff: null }

describe('session diff shortcut', () => {
  it('hides and restores the rendered file from its source session', () => {
    const hide = sessionDiffShortcut(rendered, null)
    expect(hide).toEqual({ kind: 'hide-rendered', hidden: { sessionId: 's1', target: rendered } })
    expect(sessionDiffShortcut(null, hide.kind === 'hide-rendered' ? hide.hidden : null)).toEqual({ kind: 'restore-rendered', target: rendered })
  })

  it('restores a hidden preview and uses normal diff toggling for other visible targets', () => {
    expect(sessionDiffShortcut(standaloneFile, null)).toEqual({ kind: 'toggle-diff' })
    expect(sessionDiffShortcut(diff, null)).toEqual({ kind: 'toggle-diff' })
    expect(sessionDiffShortcut(null, { sessionId: 's1', target: rendered })).toEqual({ kind: 'restore-rendered', target: rendered })
  })
})
