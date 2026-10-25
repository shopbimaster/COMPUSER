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
    },
    autostart: {
      get: () => window.electronAPI.autostartGet(),
      set: (on) => window.electronAPI.autostartSet(on)
    },
    // 教务导入网络端口：主进程代理 GET（无 CORS），返回 {ok, status, text, error}
    net: {
      get: (payload) => window.electronAPI.netGet(payload)
    }
  };
})();
