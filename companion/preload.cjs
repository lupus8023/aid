const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aidCompanion', {
  getState: () => ipcRenderer.invoke('companion:get-state'),
  authorize: input => ipcRenderer.invoke('companion:authorize', input),
  copyText: value => ipcRenderer.invoke('companion:copy', value),
  openWebsite: () => ipcRenderer.invoke('companion:open-website'),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('companion:set-login', enabled),
  quit: () => ipcRenderer.invoke('companion:quit'),
});
