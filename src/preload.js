const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('odt', {
  getState: () => ipcRenderer.invoke('state:get'),
  addLinks: (text) => ipcRenderer.invoke('queue:add', text),
  cancel: () => ipcRenderer.invoke('queue:cancel'),
  retry: (id) => ipcRenderer.invoke('queue:retry', id),
  clearFinished: () => ipcRenderer.invoke('queue:clear'),
  igLogin: () => ipcRenderer.invoke('ig:login'),
  igLogout: () => ipcRenderer.invoke('ig:logout'),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  setFormat: (f) => ipcRenderer.invoke('settings:set-format', f),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  revealFile: (p) => ipcRenderer.invoke('file:reveal', p),
  getVersions: () => ipcRenderer.invoke('tools:versions'),
  retryTools: () => ipcRenderer.invoke('tools:retry'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdate: () => ipcRenderer.invoke('update:open'),
  onUpdate: on('update:available'),
  onJob: on('job:update'),
  onTools: on('tools:status'),
  onIg: on('ig:status'),
});
