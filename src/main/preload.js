const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  pickPdfs: () => ipcRenderer.invoke('pdf:pick'),
  parsePdfs: (paths) => ipcRenderer.invoke('pdf:parse', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  resolve: (subject) => ipcRenderer.invoke('subject:resolve', subject),
  saveSetup: (payload) => ipcRenderer.invoke('setup:save', payload),
  setDone: (id, done) => ipcRenderer.invoke('item:done', id, done),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openSetup: () => ipcRenderer.invoke('setup:open'),
  hideWidget: () => ipcRenderer.invoke('widget:hide'),
  onDataChanged: (cb) => ipcRenderer.on('data:changed', (_e, data) => cb(data)),
  onRefresh: (cb) => ipcRenderer.on('widget:refresh', () => cb()),
  onOpenAppearance: (cb) => ipcRenderer.on('widget:appearance', () => cb()),
});
