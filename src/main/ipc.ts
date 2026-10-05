import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { InvokeMap, PushMap, Result, SendMap } from '@shared/ipc'
import type { Slices } from '@shared/types'
import type { AttachHandle } from '../core/backend/types'
import type { Core } from '../core/core'

type Handler<K extends keyof InvokeMap> = (arg: InvokeMap[K][0]) => Promise<InvokeMap[K][1] | Result<InvokeMap[K][1]>> | InvokeMap[K][1]

export function registerIpc(core: Core, getWindow: () => BrowserWindow | null, getErrors: () => string[]): void {
  const push = <K extends keyof PushMap>(ch: K, payload: PushMap[K]) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(ch, payload)
  }

  // Core commands return Result themselves; everything else is wrapped here.
  function handle<K extends keyof InvokeMap>(ch: K, fn: Handler<K>, returnsResult = false): void {
    ipcMain.handle(ch, async (_e, arg) => {
      try {
        const out = await fn(arg)
        return returnsResult ? out : { ok: true, data: out }
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) }
      }
    })
  }

  handle('state:get', () => core.getSlices())
  handle('app:errors', () => getErrors())
  handle('project:add', async () => {
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const win = getWindow()
    const res = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    if (res.canceled || res.filePaths.length === 0) return { ok: true, data: null }
    return core.commands.projectAdd({ path: res.filePaths[0] })
  }, true)
  handle('session:create', (a) => core.commands.sessionCreate(a), true)
  handle('ui:set', (a) => core.commands.uiSet(a), true)

  const attaches = new Map<string, AttachHandle>()
  handle('pty:attach', ({ sessionId, cols, rows }) => {
    // one live attach: the focused session
    for (const [id, h] of attaches) {
      h.kill()
      attaches.delete(id)
    }
    const attachId = randomUUID()
    const h = core.attach(sessionId, cols, rows)
    attaches.set(attachId, h)
    h.onData((data) => push('pty:data', { attachId, data }))
    h.onExit(() => {
      attaches.delete(attachId)
      push('pty:exit', { attachId })
    })
    return { attachId }
  })

  const on = <K extends keyof SendMap>(ch: K, fn: (p: SendMap[K]) => void) =>
    ipcMain.on(ch, (_e, p: SendMap[K]) => fn(p))
  on('pty:input', ({ attachId, data }) => attaches.get(attachId)?.write(data))
  on('pty:resize', ({ attachId, cols, rows }) => attaches.get(attachId)?.resize(cols, rows))
  on('pty:detach', ({ attachId }) => {
    attaches.get(attachId)?.kill()
    attaches.delete(attachId)
  })

  const pending = new Map<keyof Slices, Slices[keyof Slices]>()
  let scheduled = false
  core.on('slice', (k, v) => {
    pending.set(k, v)
    if (scheduled) return
    scheduled = true
    setImmediate(() => {
      scheduled = false
      for (const [key, value] of pending) push(`state:${key}`, value as never)
      pending.clear()
    })
  })
}
