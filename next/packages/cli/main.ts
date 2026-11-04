import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureHolder } from '../core/holder-client.ts'
import { connectWhenReady, type RpcClient } from '../protocol/client.ts'
import { METHODS, type SpaceInfo } from '../protocol/messages.ts'
import { coreSocketPath } from '../protocol/paths.ts'

const USAGE = 'usage: grove-next space add [path] | grove-next space ls | grove-next ls'

// Runs one CLI command and returns its exit code: 0 ok, 1 error (one line on stderr), 2 usage.
export async function main(argv: string[]): Promise<number> {
  const [first, second, ...rest] = argv
  try {
    if (first === 'ls' && argv.length === 1) return await listSpaces()
    if (first === 'space' && second === 'ls' && argv.length === 2) return await listSpaces()
    if (first === 'space' && second === 'add' && rest.length <= 1) return await addSpace(rest[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message.replace(/\s*\n\s*/g, ' ')}`)
    return 1
  }
  console.error(USAGE)
  return 2
}

// Starts the holder (and through it the core) when needed, then runs one call against the core.
async function withCore<T>(call: (core: RpcClient) => Promise<T>): Promise<T> {
  await ensureHolder()
  const core = await connectWhenReady(coreSocketPath())
  try {
    return await call(core)
  } finally {
    core.close()
  }
}

async function addSpace(arg: string | undefined): Promise<number> {
  const base = process.env.GROVE_NEXT_CALLER_CWD || process.cwd()
  const target = path.resolve(base, arg ?? '')
  return withCore(async (core) => {
    const before = await core.request(METHODS.spacesList, {})
    const real = realpathOrSelf(target)
    const existed = before.spaces.some((space) => space.path === real)
    const space: SpaceInfo = await core.request(METHODS.spacesAdd, { path: target })
    console.log(existed ? `already a space: ${space.path}` : `added ${space.path}`)
    return 0
  })
}

async function listSpaces(): Promise<number> {
  return withCore(async (core) => {
    const result = await core.request(METHODS.spacesList, {})
    if (result.refused !== null) {
      console.error(`error: ${result.refused}`)
      return 1
    }
    if (result.spaces.length === 0) console.log('no spaces')
    for (const space of result.spaces) {
      console.log(space.parent !== null ? `${space.path}  (worktree of ${space.parent})` : space.path)
      const tabs = result.tabs.filter((tab) => tab.spacePath === space.path)
      tabs.forEach((tab, index) => {
        console.log(`  ${index + 1}  ${tab.id}  ${tab.alive ? 'alive' : 'exited'}`)
      })
    }
    return 0
  })
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

// Run directly (node --import tsx packages/cli/main.ts, or bin/grove-next), not when imported by a test.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
