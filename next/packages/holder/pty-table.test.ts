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
})
