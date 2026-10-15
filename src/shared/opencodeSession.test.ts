import { describe, expect, it } from 'vitest'
import { opencodeModelEnv } from './opencodeSession'

describe('opencodeModelEnv', () => {
  it('is empty without a model', () => {
    expect(opencodeModelEnv(undefined)).toEqual({})
    expect(opencodeModelEnv('', '{"a":1}')).toEqual({})
  })

  it('sets the model as inline config', () => {
    expect(opencodeModelEnv('p/m')).toEqual({ OPENCODE_CONFIG_CONTENT: '{"model":"p/m"}' })
  })

  it('keeps other keys of an existing config and overrides its model', () => {
    const env = opencodeModelEnv('p/m', '{"model":"x/y","theme":"t","provider":{"a":{}}}')
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual({ model: 'p/m', theme: 't', provider: { a: {} } })
  })

  it('replaces an unparsable or non-object existing value', () => {
    for (const bad of ['{nope', '[1]', '"x"', 'null', '7']) {
      expect(opencodeModelEnv('p/m', bad)).toEqual({ OPENCODE_CONFIG_CONTENT: '{"model":"p/m"}' })
    }
  })
})
