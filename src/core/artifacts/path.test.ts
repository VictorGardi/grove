import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArtifactUrl } from '@shared/artifactUrl'
import { setupCore } from '../testing/setup'
import { safeArtifactPath } from './path'

describe('artifact paths', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  async function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const folder = path.join(s.dir, 'docs', 'work', 'a')
    const write = (rel: string, content = '') => {
      fs.mkdirSync(path.dirname(path.join(s.dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(s.dir, rel), content)
    }
    write('docs/work/a/feature.md', '---\nkind: feature\n---\n# a\n')
    write('docs/work/a/03-design.html', '<p>design</p>')
    write('docs/work/a/refs/x.png')
    write('docs/work/a/.hidden.html')
    write('docs/work/a/.dot/x.html')
    fs.mkdirSync(path.join(folder, 'dir.html'))
    write('outside.html', 'secret')
    fs.symlinkSync(path.join(s.dir, 'outside.html'), path.join(folder, 'link.html'))
    const core = s.make()
    await core.start()
    return { ...s, core, folder }
  }

  it('resolves files inside the feature folder, sub-paths included', async () => {
    const { core, folder } = await setup()
    expect(core.artifactPath('p', 'a', '03-design.html')).toBe(fs.realpathSync(path.join(folder, '03-design.html')))
    expect(core.artifactPath('p', 'a', 'refs/x.png')).toBe(fs.realpathSync(path.join(folder, 'refs/x.png')))
    expect(safeArtifactPath(folder, '03-design.html')).toBe(fs.realpathSync(path.join(folder, '03-design.html')))
  })

  it('refuses traversal, absolute, backslash, dot paths, escaping symlinks, directories and missing files', async () => {
    const { core, dir } = await setup()
    for (const rel of [
      '../../../outside.html',
      'refs/../../a/03-design.html',
      path.join(dir, 'outside.html'),
      'refs\\x.png',
      '.hidden.html',
      '.dot/x.html',
      'link.html',
      'dir.html',
      'missing.html',
      '',
    ]) expect(core.artifactPath('p', 'a', rel), rel).toBeNull()
  })

  it('refuses unknown slugs and projects', async () => {
    const { core } = await setup()
    expect(core.artifactPath('p', 'nope', '03-design.html')).toBeNull()
    expect(core.artifactPath('other', 'a', '03-design.html')).toBeNull()
  })

  it('refuses encoded traversal arriving through a URL', async () => {
    const { core } = await setup()
    for (const url of [
      'grove-artifact://p/a/%2e%2e/%2e%2e/outside.html',
      'grove-artifact://p/a/..%2F..%2F..%2Foutside.html',
    ]) {
      const t = parseArtifactUrl(url)
      expect(t === null || core.artifactPath(t.projectId, t.slug, t.path) === null, url).toBe(true)
    }
  })
})
