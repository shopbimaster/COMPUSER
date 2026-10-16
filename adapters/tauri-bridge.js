/*!
 * 端口适配器 · Tauri 桥（Android / 桌面 Tauri 壳）
 * 仅当运行于 Tauri WebView（存在 __TAURI_INTERNALS__）且未被 Electron 桥注入时生效：
 * - storage：Rust 命令读写 app_data_dir/schedule.json（与 Electron 版同格式同语义）
 * - share.send：Android 走系统分享面板（临时文件 + share_file_android 命令），
 *   桌面走另存为对话框（plugin:dialog|save）+ Rust 写盘
 * - share.receive：Android 上 dialog|open 返回 content:// URI（mime 过滤会挡住
 *   微信/QQ 下载的 octet-stream 文件，故不传 filters），经 WebView fetch 读取；
 *   桌面走 dialog|open 路径 + Rust read_text_file
 * - statusBar.setLightIcons：Android 状态栏图标颜色随应用主题（Rust 主线程 JNI）
 * 插件命令名核实自 @tauri-apps/plugin-dialog@2.8.2 dist-js（open/save 传 { options }）。
 */
(function () {
  'use strict';
  if (window.__ports) return; // Electron 桥已注入
  const internals = window.__TAURI_INTERNALS__;
  if (!internals) return; // 非 Tauri 环境 → 浏览器桥兜底

  const invoke = (cmd, args) => internals.invoke(cmd, args || {});
  const MIME = {
    json: 'application/json',
    csv: 'text/csv',
    ics: 'text/calendar',
    txt: 'text/plain'
  };
  const mimeOf = (name) => {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return MIME[ext] || 'application/octet-stream';
  };
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();
  const FILTERS = [
    { name: 'CAMPUSER 导入文件', extensions: ['json', 'csv', 'ics', 'txt'] }
  ];

  const ports = {
    isElectron: false,
    isTauri: true,
    platform: null, // 'android' | 'windows' | 'macos' | 'linux'（init 异步填充）
    storage: {
      load: async () => {
        try { return await invoke('load_data'); } catch (e) { return null; }
      },
      save: async (text) => { await invoke('save_data', { text: String(text) }); }
    },
    share: {
      // 发送：Android 分享面板 / 桌面另存为；返回展示用路径或 null（取消）
      send: async (text, defaultName) => {
        const name = defaultName || 'campuser-export.txt';
        if (ports.platform === 'android') {
          const path = await invoke('write_temp_file', { name, text: String(text) });
          await invoke('share_file_android', { path, mime: mimeOf(name) });
          return `（已唤起分享：${name}）`;
        }
        const path = await invoke('plugin:dialog|save', { options: { defaultPath: name } });
        if (!path) return null;
        await invoke('write_file', { path, text: String(text) });
        return path;
      },
      // 接收：选择文件并读文本；返回 {name,text} | {name,error} | null（取消）
      receive: async () => {
        if (ports.platform === 'android') {
          // Android 返回 content:// URI 数组；std::fs 读不了 → WebView fetch 读取
          // （AllowContentAccess 默认开启）。不传 filters：ACTION_GET_CONTENT 按
          // mime 过滤会挡住微信/QQ 下载的 octet-stream 文件
          let picked = null;
          try {
            picked = await invoke('plugin:dialog|open', { options: { multiple: false } });
          } catch (e) { return null; }
          const uri = Array.isArray(picked) ? picked[0] : (picked && picked.files ? picked.files[0] : picked);
          if (!uri) return null;
          try {
            const resp = await fetch(uri);
            return { name: baseName(decodeURIComponent(String(uri))), text: await resp.text() };
          } catch (e) {
            return { name: baseName(decodeURIComponent(String(uri))), error: true };
          }
        }
        let path = null;
        try {
          path = await invoke('plugin:dialog|open', { options: { multiple: false, filters: FILTERS } });
        } catch (e) { return null; }
        if (!path) return null;
        if (Array.isArray(path)) path = path[0];
        try {
          return { name: baseName(path), text: await invoke('read_text_file', { path }) };
        } catch (e) {
          return { name: baseName(path), error: true };
        }
      }
    },
    // Android 状态栏图标颜色（浅色页面→深图标；深色页面→白图标）；其他平台为空
    statusBar: {
      setLightIcons: (light) => {
        invoke('set_status_bar_icons', { light: !!light }).catch(() => {});
      }
    }
  };

  window.__ports = ports;
  invoke('os_platform')
    .then((p) => { ports.platform = p; })
    .catch(() => {});
})();
