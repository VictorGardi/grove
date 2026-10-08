import { describe, expect, it } from 'vitest'
import type { Feature, Project } from '@shared/types'
import { TAG_COUNT, colorTags } from './tags'

const project = (id: string): Project => ({ id, name: id, path: '/' + id })
const feature = (projectId: string, slug: string, group = false): Feature => ({
  projectId, slug, path: '', title: slug, kind: group ? 'epic' : 'feature', group, parent: null, flow: null,
  stages: [], currentStage: null, cardState: 'done', progress: null, flags: [], warnings: [], artifacts: [],
})

describe('colorTags', () => {
  it('colours projects by position and their groups after them, by slug', () => {
    const tags = colorTags([project('p'), project('q')], [
      feature('p', 'z-epic', true), feature('p', 'a-epic', true), feature('p', 'plain'), feature('q', 'e', true),
    ])
    expect(tags.project('p')).toBe(0)
    expect(tags.project('q')).toBe(1)
    expect(tags.group('p', 'a-epic')).toBe(1)
    expect(tags.group('p', 'z-epic')).toBe(2)
    expect(tags.group('q', 'e')).toBe(2)
    expect(tags.group('p', 'plain')).toBeNull()
    expect(tags.group('p', null)).toBeNull()
  })

  it('wraps around the palette and never gives a group its own project colour below the palette size', () => {
    const groups = Array.from({ length: TAG_COUNT - 1 }, (_, i) => feature('p', `e${i}`, true))
    const tags = colorTags([project('p')], groups)
    for (const g of groups) expect(tags.group('p', g.slug)).not.toBe(tags.project('p'))
    expect(colorTags(Array.from({ length: TAG_COUNT + 1 }, (_, i) => project(`p${i}`)), []).project(`p${TAG_COUNT}`)).toBe(0)
  })
})
