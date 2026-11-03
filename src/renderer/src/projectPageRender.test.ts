import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'
import { ProjectPage } from './components/ProjectPage'

// Rendered with react-dom/server: no jsdom here, and the page is a pure function of its props.

const project = { id: 'p', name: 'grove', path: '/src/p' } as Project
const render = () => renderToStaticMarkup(createElement(ProjectPage, { project, onNewSession: vi.fn() }))

describe('ProjectPage', () => {
  it('shows the project name, a new session button and the cmd+K hint', () => {
    const html = render()
    expect(html).toContain('>grove</h1>')
    expect(html).toMatch(/<button[^>]*>[^]*New session<\/button>/)
    expect(html).toContain('⌘K to find features, artifacts and sessions')
  })

  it('draws no board, column or list', () => {
    const html = render()
    for (const word of ['Waiting', 'Working', 'Questions', 'Artifacts board']) expect(html).not.toContain(word)
  })
})
