// 存储层：Electron 环境读写本地 JSON 文件（data/schedule.json），
// 浏览器环境降级为 localStorage。数据完全本地，无任何网络请求。
const Storage = (() => {
  const LS_KEY = 'wakeup-schedule-data';

  async function load() {
    if (window.electronAPI) {
      return await window.electronAPI.loadData();
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async function save(data) {
    if (window.electronAPI) {
      return await window.electronAPI.saveData(data);
    }
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return true;
  }

  // 导入：返回 {courses, settings} 或 null（取消）/ {error}
  async function importJson() {
    if (window.electronAPI) {
      return await window.electronAPI.openJson();
    }
    // 浏览器降级：<input type=file>
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          try {
            resolve({ path: file.name, content: JSON.parse(reader.result) });
          } catch (e) {
            resolve({ path: file.name, error: String(e) });
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file, 'utf-8');
      };
      input.click();
    });
  }

  // 导出：返回保存路径或 true，取消返回 null
  async function exportJson(data) {
    if (window.electronAPI) {
      return await window.electronAPI.saveJson(data);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wakeup-schedule-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return '(浏览器下载)';
  }

  return { load, save, importJson, exportJson, isElectron: !!window.electronAPI };
})();
