/*!
 * 端口适配器 · Electron 桥
 * 仅当渲染进程运行在 Electron（存在 preload 注入的 electronAPI）时生效，
 * 将 IPC 能力包装为统一的 Storage/Share 端口，注入 window.__ports。
 */
(function () {
  'use strict';
  if (!window.electronAPI) return;

  window.__ports = {
    isElectron: true,
    storage: {
      load: () => window.electronAPI.loadData(),
      save: (text) => window.electronAPI.saveData(text)
    },
    share: {
      // 发送：弹出另存为对话框写文件，返回保存路径或 null（取消）
      send: (text, defaultName) => window.electronAPI.exportFile({ text: String(text), defaultName }),
      // 接收：弹出打开对话框读文件，返回 {name, text} | {name, error} | null
      receive: () => window.electronAPI.importFile()
    }
  };
})();
