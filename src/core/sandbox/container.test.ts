import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneContainers, removeContainer } from './container'

const temps: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-container-'))
  temps.push(d)
  return d
}
afterEach(() => temps.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

// A `container` that records every invocation and answers `list` from a fixture file. The real
// binary is never touched by a test: it is this machine's live sandbox system.
const fakeContainer = (body: string): { file: string; log: () => string[] } => {
  const file = path.join(tmp(), 'container')
  const logFile = `${file}.log`
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> ${JSON.stringify(logFile)}\n${body}\n`, { mode: 0o755 })
  return { file, log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : []) }
}

// `container list --all --quiet` prints one name per line, running and stopped alike.
const lists = (names: string[]) => `if [ "$*" = "list --all --quiet" ]; then printf '%s\\n' ${names.map((n) => `'${n}'`).join(' ')}; fi`

describe('removeContainer', () => {
  it('removes the named container', async () => {
    const { file, log } = fakeContainer('exit 0')
    await removeContainer(file, 'grove-abc')
    expect(log()).toEqual(['rm -f grove-abc'])
  })

  // `--rm` covers a clean agent exit; this is the SIGKILLed one, where the container is already
  // gone. A teardown that reported that as a failure would fail the ⌘W that came with it.
  it('tolerates a container that is not there', async () => {
    const { file, log } = fakeContainer('echo "Error: no such container" >&2\nexit 1')
    await expect(removeContainer(file, 'grove-gone')).resolves.toBeUndefined()
    expect(log()).toEqual(['rm -f grove-gone'])
  })

  it('never rejects, not even on a missing binary', async () => {
    await expect(removeContainer(path.join(tmp(), 'absent'), 'grove-abc')).resolves.toBeUndefined()
  })
})

describe('pruneContainers', () => {
  // What a crash leaves behind: a running container whose pane tmux still owns, a stopped one
  // nobody owns, and a container that has nothing to do with grove.
  it('removes grove containers with no live session and nothing else', async () => {
    const { file, log } = fakeContainer(`${lists(['grove-live', 'grove-dead', 'grove-orphan', 'someone-elses-box'])}\nexit 0`)
    await pruneContainers(file, ['grove-live'])
    expect(log()).toEqual(['list --all --quiet', 'rm -f grove-dead', 'rm -f grove-orphan'])
  })

  it('lists stopped containers too, so an orphan of a killed pane is found', async () => {
    const { file, log } = fakeContainer(`${lists(['grove-dead'])}\nexit 0`)
    await pruneContainers(file, [])
    expect(log()[0]).toBe('list --all --quiet')
    expect(log()).toContain('rm -f grove-dead')
  })

  // Without tmux grove cannot tell an orphan from a running session, so it prunes nothing.
  it('prunes nothing when the container system is not running', async () => {
    const { file, log } = fakeContainer('echo "Error: connect: connection refused" >&2\nexit 1')
    await expect(pruneContainers(file, [])).resolves.toBeUndefined()
    expect(log()).toEqual(['list --all --quiet'])
  })

  it('prunes nothing when there is nothing to prune', async () => {
    const { file, log } = fakeContainer(`${lists([])}\nexit 0`)
    await pruneContainers(file, [])
    expect(log()).toEqual(['list --all --quiet'])
  })
})