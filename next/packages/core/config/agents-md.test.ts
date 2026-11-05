import { describe, expect, it } from 'vitest'
import { renderAgentsMd } from './agents-md.ts'
import { FILES, KEY_ACTIONS, THEME_TOKENS } from './schema.ts'

describe('AGENTS.md', () => {
  const text = renderAgentsMd()

  it('names every file', () => {
    for (const file of FILES) expect(text).toContain(file)
  })

  it('names every key, action, theme token and launcher field', () => {
    for (const action of KEY_ACTIONS) expect(text).toContain(`\`${action}\``)
    for (const token of THEME_TOKENS) expect(text).toContain(token)
    for (const name of ['sidebarWidth', 'launchers', 'tokens', 'sidebarOrder', '"id"', '"label"', '"command"', '"args"', '"env"']) {
      expect(text).toContain(name)
    }
  })

  it('says that a bad file keeps its last good version', () => {
    expect(text).toContain('keeps its last good values')
  })
})
