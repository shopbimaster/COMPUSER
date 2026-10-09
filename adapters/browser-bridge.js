/*!
 * 端口适配器 · 浏览器桥（降级实现）
 * 未被 Electron 桥注入时生效：localStorage 充当存储、
 * Blob 下载/文件选择器充当文件分享通道。
 */
(function () {
  'use strict';
  if (window.__ports) return; // Electron 桥已注入，浏览器桥让位

  const LS_KEY = 'campuser-schedule-data';
  const LS_KEY_LEGACY = 'wakeup-schedule-data'; // 品牌更名前的浏览器存储键（只读迁移）

  window.__ports = {
    isElectron: false,
    storage: {
      load: async () => {
        try {
          const cur = localStorage.getItem(LS_KEY);
          if (cur !== null) return cur;
          const legacy = localStorage.getItem(LS_KEY_LEGACY); // 旧键一次性迁移
          if (legacy !== null) {
            localStorage.setItem(LS_KEY, legacy);
            localStorage.removeItem(LS_KEY_LEGACY);
          }
          return legacy;
        } catch (e) { return null; }
      },
      save: async (text) => localStorage.setItem(LS_KEY, String(text))
    },
    share: {
      send: async (text, defaultName) => {
        const blob = new Blob([String(text)], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName || 'campuser-export.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return '(浏览器下载)';
      },
      receive: () => new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv,.ics,.txt';
        input.onchange = () => {
          const f = input.files && input.files[0];
          if (!f) return resolve(null);
          const r = new FileReader();
          r.onload = () => resolve({ name: f.name, text: String(r.result) });
          r.onerror = () => resolve(null);
          r.readAsText(f, 'utf-8');
        };
        input.click();
      })
    }
  };
})();
