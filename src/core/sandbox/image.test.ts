import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureImage, imageRef } from './image'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-image-'))

const dockerfile = (dir: string, text: string) => {
  fs.writeFileSync(path.join(dir, 'Dockerfile'), text)
  return path.join(dir, 'Dockerfile')
}

// A `container` that answers `image ls` with `listed` and records every invocation in its own log.
const fakeContainer = (dir: string, listed: string) => {
  const file = path.join(dir, 'container')
  const log = `${file}.log`
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2 $3" = "image ls --quiet" ] && printf '%s\\n' ${listed}\nexit 0\n`, {
    mode: 0o755,
  })
  return { file, log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) }
}

describe('imageRef', () => {
  it('is the first 12 hex of the Dockerfile’s sha256', () => {
    const file = dockerfile(tmp(), 'FROM node:22-slim\n')
    expect(imageRef(file)).toBe(`grove-sandbox:${imageRef(file).split(':')[1]}`)
    expect(imageRef(file)).toMatch(/^grove-sandbox:[0-9a-f]{12}$/)
    // the tag changes with the bytes, and only with the bytes
    expect(imageRef(dockerfile(tmp(), 'FROM node:22-slim\nRUN true\n'))).not.toBe(imageRef(file))
    expect(imageRef(file)).toBe(imageRef(file))
  })
})

describe('ensureImage', () => {
  it('builds nothing when the tag is already there', async () => {
    const dir = tmp()
    const { file, log } = fakeContainer(dir, "'grove-sandbox:abc'")
    await ensureImage({ container: file, dir, tag: 'grove-sandbox:abc' })
    expect(log()).toEqual(['image ls --quiet'])
  })

  it('builds the tag once when it is missing', async () => {
    const dir = tmp()
    const fresh = fakeContainer(dir, "'alpine:latest'")
    await ensureImage({ container: fresh.file, dir, tag: 'grove-sandbox:def' })
    expect(fresh.log()).toEqual(['image ls --quiet', `build -t grove-sandbox:def ${dir}`])
  })

  it('rejects when the build fails', async () => {
    const dir = tmp()
    const file = path.join(dir, 'container')
    fs.writeFileSync(file, '#!/bin/sh\ncase "$1" in build) echo boom >&2; exit 1;; esac\nexit 0\n', { mode: 0o755 })
    await expect(ensureImage({ container: file, dir, tag: 'grove-sandbox:abc' })).rejects.toThrow()
  })

  it('rejects when the binary is not there at all', async () => {
    await expect(ensureImage({ container: path.join(tmp(), 'absent'), dir: tmp(), tag: 't' })).rejects.toThrow()
  })
})