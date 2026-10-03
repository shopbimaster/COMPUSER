// 预加载脚本：向渲染进程安全暴露本地文件读写能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  openJson: () => ipcRenderer.invoke('dialog:openJson'),
  saveJson: (data) => ipcRenderer.invoke('dialog:saveJson', data)
});
