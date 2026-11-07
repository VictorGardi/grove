import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyTable } from './pty-table.ts'

const SHELL = '/bin/sh'

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('PtyTable', () => {
  const tables: PtyTable[] = []
  afterEach(() => {
    for (const table of tables.splice(0)) table.killAll()
  })

  it('gives a fresh viewer the saved screen and streams later output to listeners', async () => {
    const table = new PtyTable()
    tables.push(table)
    const id = table.create({
      command: SHELL,
      args: ['-c', 'printf hello; read line; printf "after %s" "$line"; sleep 5'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    })

    const first = await waitFor(
      () => table.attach(id, { onOutput: () => {}, onExit: () => {} }),
      (attached) => attached.screen.includes('hello'),
    )
    expect(first.screen).toContain('hello')
    first.detach()

    const live: string[] = []
    const second = await table.attach(id, { onOutput: (data) => live.push(data), onExit: () => {} })
    expect(second.screen).toContain('hello')
    expect(second.cols).toBe(80)
    expect(second.rows).toBe(24)
    second.flush()

    table.write(id, 'there\n')
    await waitFor(async () => live.join(''), (text) => text.includes('after there'))
    expect(live.join('')).toContain('after there')
    second.detach()
  })

  it('delivers output written while an attach is in flight exactly once, after the screen', async () => {
    const table = new PtyTable()
    tables.push(table)
    const id = table.create({
      command: SHELL,
      args: ['-c', 'printf ready; read line; printf "echo %s" "$line"; sleep 5'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    })
    await waitFor(
      () => table.attach(id, { onOutput: () => {}, onExit: () => {} }),
      (attached) => attached.screen.includes('ready'),
    )

    const live: string[] = []
    const attaching = table.attach(id, { onOutput: (data) => live.push(data), onExit: () => {} })
    table.write(id, 'gap\n')
    const attached = await attaching
    expect(live).toEqual([])
    attached.flush()
    await waitFor(async () => live.join(''), (text) => text.includes('echo gap'))
    expect(live.join('').match(/echo gap/g)).toHaveLength(1)
    attached.detach()
  })

  it('returns the visible rows of the screen as plain text', async () => {
    const table = new PtyTable()
    tables.push(table)
    const id = table.create({
      command: SHELL,
      args: ['-c', 'printf "first line\\r\\n\\033[31mred words\\033[0m\\r\\n"; sleep 5'],
      cwd: process.cwd(),
      cols: 40,
      rows: 5,
    })
    const text = await waitFor(
      () => table.screen(id),
      (screen) => screen.includes('red words'),
    )
    const rows = text.split('\n')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toBe('first line')
    expect(rows[1]).toBe('red words')
    expect(text).not.toContain('\x1b')
  })

  it('reports exit and lists the tab as not alive', async () => {
    const table = new PtyTable()
    tables.push(table)
    const id = table.create({ command: SHELL, args: ['-c', 'exit 3'], cwd: process.cwd(), cols: 80, rows: 24 })

    const [tab] = await waitFor(
      async () => table.list(),
      (tabs) => tabs.some((item) => item.id === id && !item.alive),
    )
    expect(tab).toMatchObject({ id, alive: false, exitCode: 3 })
  })

  it('forwards only root status records and parses their kind', async () => {
    const table = new PtyTable()
    tables.push(table)
    const records = [
      'state=blocked;kind=auth',
      'state=blocked;kind=question;id=child',
      'state=clear',
      'state=future-state',
    ]
    const script = `for (const record of ${JSON.stringify(records)}) process.stdout.write('\\x1b]7501;' + record + '\\x1b\\\\')`
    const id = table.create({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), cols: 80, rows: 24 })
    const statuses: Array<{ state: string; kind?: string }> = []
    table.onStatus((tabId, status) => {
      if (tabId === id) statuses.push(status)
    })

    await waitFor(async () => statuses.length, (count) => count === 3)
    expect(statuses).toEqual([{ state: 'blocked', kind: 'auth' }, { state: 'clear' }, { state: 'future-state' }])
  })

  it('lists the last root status and excludes child status records', async () => {
    const table = new PtyTable()
    tables.push(table)
    const records = ['state=working;kind=task', 'state=blocked;kind=question;id=child']
    const script = `for (const record of ${JSON.stringify(records)}) process.stdout.write('\\x1b]7501;' + record + '\\x1b\\\\')`
    const id = table.create({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), cols: 80, rows: 24 })

    await waitFor(async () => table.list(), (tabs) => tabs[0]?.status?.state === 'working')

    expect(table.list()).toMatchObject([{ id, status: { state: 'working', kind: 'task' } }])
    expect(await table.listLive()).toMatchObject([{ id, status: { state: 'working', kind: 'task' } }])
  })

  it('lists the folder the shell is in now and the foreground program, not where the tab started', async () => {
    const table = new PtyTable()
    tables.push(table)
    const start = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-start-'))
    const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-moved-'))
    const id = table.create({
      command: SHELL,
      args: ['-c', `cd "${moved}" && sleep 5`],
      cwd: start,
      cols: 80,
      rows: 24,
    })

    const live = await waitFor(
      () => table.listLive(),
      (tabs) => tabs.find((tab) => tab.id === id)?.cwd === fs.realpathSync(moved),
    )
    const tab = live.find((candidate) => candidate.id === id)
    expect(tab?.cwd).toBe(fs.realpathSync(moved))
    expect(tab?.foreground).toEqual(expect.any(String))
    expect(tab?.alive).toBe(true)
  })

  it('names a foreground program by the name it was run under when its binary has another name', async () => {
    // A native Claude install: the binary is versions/<number>, and the command is a link named claude. The binary is
    // built with the C compiler: a copy of a system binary is killed by macOS, and a link reports its target's name.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-native-'))
    const versions = path.join(dir, 'versions')
    fs.mkdirSync(versions)
    const binary = path.join(versions, '2.1.309')
    fs.writeFileSync(path.join(dir, 'sleeper.c'), '#include <unistd.h>\nint main(void) { sleep(5); return 0; }\n')
    execFileSync('cc', ['-o', binary, path.join(dir, 'sleeper.c')])
    const link = path.join(dir, 'claude')
    fs.symlinkSync(binary, link)
    const table = new PtyTable()
    tables.push(table)
    const id = table.create({ command: link, args: [], cwd: dir, cols: 80, rows: 24 })

    const live = await waitFor(
      () => table.listLive(),
      (tabs) => tabs.find((tab) => tab.id === id)?.argv0 === 'claude',
    )
    expect(live.find((tab) => tab.id === id)).toMatchObject({ foreground: '2.1.309', argv0: 'claude' })
  })
})
