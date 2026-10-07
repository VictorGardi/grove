const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', {
  write: (d) => ipcRenderer.send('pty-in', d),
  resize: (cols, rows) => ipcRenderer.send('pty-resize', { cols, rows }),
  onData: (cb) => ipcRenderer.on('pty-out', (_e, d) => cb(d)),
  onReport: (cb) => ipcRenderer.on('report', () => cb()),
  log: (kind, data) => ipcRenderer.send('rlog', kind, data),
  cfg: () => ipcRenderer.invoke('cfg'),
});
