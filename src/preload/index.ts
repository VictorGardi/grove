import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/ipc'

const api: Api = {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  send: (ch, p) => ipcRenderer.send(ch, p),
  on: (ch, cb) => {
    const listener = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
    ipcRenderer.on(ch, listener)
    return () => { ipcRenderer.removeListener(ch, listener) }
  },
}

contextBridge.exposeInMainWorld('api', api)
