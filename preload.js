// WakeUp 课程表本地版 - 预加载脚本
// 安全暴露端口所需的系统能力：数据读写 + 文件分享（另存为/打开）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (text) => ipcRenderer.invoke('data:save', text),
  exportFile: (payload) => ipcRenderer.invoke('share:exportFile', payload),
  importFile: () => ipcRenderer.invoke('share:importFile'),
  autostartGet: () => ipcRenderer.invoke('autostart:get'),
  autostartSet: (on) => ipcRenderer.invoke('autostart:set', on),
  // 教务导入：主进程代理 HTTP GET（绕过渲染进程 CORS；不跟随到非同源跳转）
  netGet: (payload) => ipcRenderer.invoke('net:get', payload),
  // 教务导入：内嵌登录窗口（独立会话分区）与会话 Cookie 读取
  hubOpenLogin: (url) => ipcRenderer.invoke('hub:openLogin', url),
  hubCloseLogin: () => ipcRenderer.invoke('hub:closeLogin'),
  hubGetCookies: () => ipcRenderer.invoke('hub:getCookies')
});
