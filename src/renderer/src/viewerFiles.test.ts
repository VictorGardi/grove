import { describe, expect, it } from 'vitest'
import type { Feature, FeatureStage, Project } from '@shared/types'
import { featureDir, featureOfFile, reviewTarget, viewableFiles } from './viewerFiles'

type Artifact = Feature['artifacts'][number]

const feature = (partial: Partial<Feature>): Feature => ({
  projectId: 'p',
  slug: 'f',
  path: '/x',
  title: 'f',
  kind: 'feature',
  group: false,
  parent: null,
  flow: null,
  stages: [],
  currentStage: null,
  cardState: 'needs-review',
  progress: null,
  flags: [],
  warnings: [],
  artifacts: [],
  ...partial,
})

const stages = [{ id: 'questions', label: 'Questions' }, { id: 'research', label: 'Research' }, { id: 'design', label: 'Design' }]
const art = (name: string, stage: string | null = null, role: Artifact['role'] = null): Artifact => ({ name, stage, role, mtimeMs: 0 })

describe('viewableFiles', () => {
  it('groups viewable files by stage in workflow order, then Other', () => {
    const f = feature({
      artifacts: [
        art('03-design.md', 'design', 'artifact'),
        art('01-questions.md', 'questions', 'artifact'),
        art('02-research.html', 'research', 'review'),
        art('02-research.md', 'research', 'artifact'),
        art('feature.md'),
        art('notes.txt'),
        art('00-ticket.md'),
      ],
    })
    expect(viewableFiles(f, stages)).toEqual([
      { label: 'Questions', files: ['01-questions.md'] },
      { label: 'Research', files: ['02-research.html', '02-research.md'] },
      { label: 'Design', files: ['03-design.md'] },
      { label: 'Other', files: ['feature.md', '00-ticket.md'] },
    ])
  })

  it('puts a file tagged with an unknown stage in Other', () => {
    expect(viewableFiles(feature({ artifacts: [art('x.md', 'gone', 'artifact')] }), stages))
      .toEqual([{ label: 'Other', files: ['x.md'] }])
  })

  it('returns no groups when nothing is viewable', () => {
    expect(viewableFiles(feature({ artifacts: [art('notes.txt')] }), stages)).toEqual([])
  })
})

describe('reviewTarget', () => {
  const design: FeatureStage = { id: 'design', label: 'Design', artifact: '03-design.md', review: '03-design.html', state: 'current' }
  const at = (names: string[], st = design, currentStage: string | null = 'design') =>
    reviewTarget(feature({ stages: [st], currentStage, artifacts: names.map((n) => art(n)) }))

  it('prefers the current stage review file', () => {
    expect(at(['03-design.md', '03-design.html'])).toBe('03-design.html')
  })

  it('falls back to the artifact when the review file is absent', () => {
    expect(at(['03-design.md'])).toBe('03-design.md')
  })

  it('has no target when neither file exists', () => {
    expect(at(['feature.md'])).toBeNull()
  })

  it('has no target when the feature is done', () => {
    expect(at(['03-design.md', '03-design.html'], design, null)).toBeNull()
  })

  it('uses the artifact for a stage without a review', () => {
    expect(at(['03-design.md'], { ...design, review: null })).toBe('03-design.md')
  })
})

describe('featureOfFile', () => {
  const projects: Project[] = [{ id: 'p', name: 'proj', path: '/repo' }]
  const a = feature({ slug: 'a', path: '/repo/docs/work/a' })
  const outside = feature({ slug: 'o', path: '/elsewhere/o' })
  const file = (path: string) => ({ kind: 'file' as const, projectId: 'p', path, hash: null, fromDiff: null })

  it('finds the feature whose folder holds the file, with its project-relative dir', () => {
    expect(featureOfFile(file('docs/work/a/03-design.md'), [outside, a], projects)).toEqual({ feature: a, dir: 'docs/work/a/' })
    expect(featureDir(a, projects)).toBe('docs/work/a/')
  })

  it('finds none for project files outside feature folders, or a folder outside the project', () => {
    expect(featureOfFile(file('CONTEXT.md'), [a], projects)).toBeUndefined()
    expect(featureOfFile(file('docs/work/ab/x.md'), [a], projects)).toBeUndefined()
    expect(featureOfFile(file('o/x.md'), [outside], projects)).toBeUndefined()
    expect(featureDir(outside, projects)).toBeNull()
  })
})
