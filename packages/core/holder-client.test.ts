import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coreSocketPath } from '../protocol/paths.ts'
import { METHODS } from '../protocol/messages.ts'
import { ensureHolder } from './holder-client.ts'
import { connectWhenReady, stopHolder } from './test-helpers.ts'

describe('ensureHolder', () => {
  let home: string
  let holder: ChildProcess | undefined
  const savedHome = process.env.GROVE_NEXT_HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-'))
    process.env.GROVE_NEXT_HOME = home
  })

  afterEach(async () => {
    await stopHolder(holder)
    holder = undefined
    if (savedHome === undefined) delete process.env.GROVE_NEXT_HOME
    else process.env.GROVE_NEXT_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts a holder and core from nothing, and the core answers corePing', async () => {
    holder = await ensureHolder()
    expect(holder).toBeDefined()

    const core = await connectWhenReady(coreSocketPath())
    try {
      const { protocolVersion } = await core.request(METHODS.corePing, {})
      expect(protocolVersion).toBe(1)
    } finally {
      core.close()
    }

    expect(await ensureHolder()).toBeUndefined()
  })
})
