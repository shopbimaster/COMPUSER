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
  const { parseSnapshot } = window.CampuserPersistence;
  const readCurrent = () => localStorage.getItem(LS_KEY) ?? localStorage.getItem(LS_KEY_LEGACY);
  function save(text, { expected }) {
    parseSnapshot(text);
    const previous = readCurrent();
    if (previous !== expected) throw new Error('数据已被其他窗口修改，请先导出当前修改，再重新加载');
    if (previous !== null) {
      let valid = true;
      try { parseSnapshot(previous); } catch { valid = false; }
      if (valid) localStorage.setItem(LS_KEY + '.bak', previous);
      else localStorage.setItem(LS_KEY + '.corrupt-' + Date.now() + '-' + Math.random().toString(36).slice(2), previous);
    } else if (localStorage.getItem(LS_KEY + '.bak') === null) {
      localStorage.setItem(LS_KEY + '.bak', text);
    }
    localStorage.setItem(LS_KEY, text);
  }

  window.__ports = {
    isElectron: false,
    storage: {
      load: async () => ({ text: readCurrent(), backup: localStorage.getItem(LS_KEY + '.bak') }),
      save: async (text, options) => navigator.locks
        ? navigator.locks.request(LS_KEY, () => save(String(text), options))
        : save(String(text), options)
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
        input.oncancel = () => resolve(null);
        input.click();
      })
    }
  };
})();
