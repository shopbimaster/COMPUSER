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
    // 教务导入网络端口：Rust http_get 代理 GET（无 CORS/自签证书兼容），{ok,status,text,error}
    net: {
      get: async (payload) => {
        try {
          return await invoke('http_get', { url: String(payload.url), headers: payload.headers || null });
        } catch (e) {
          return { ok: false, status: 0, text: '', error: String((e && e.message) || e) };
        }
      }
    },
    // 教务导入登录窗口：Android 开外部 URL WebView + CookieManager 读会话
    hub: {
      openLogin: async (url) => {
        try { await invoke('hub_open_login', { url: String(url) }); return true; }
        catch (e) { return false; }
      },
      closeLogin: async () => { try { await invoke('hub_close_login'); } catch (e) { /* 窗口可能已关 */ } },
      getCookies: async () => {
        try { return (await invoke('hub_get_cookies')) || ''; }
        catch (e) { return ''; }
      }
    },
    storage: {
      load: async () => {
        try { return await invoke('load_data'); } catch (e) { return null; }
      },
      save: async (text) => { await invoke('save_data', { text: String(text) }); }
    },
    share: {
      // 发送：Android 调系统「另存为」窗口直接保存 / 桌面另存为；返回展示用路径或 null（取消）
      send: async (text, defaultName) => {
        const name = defaultName || 'campuser-export.txt';
        const target = await invoke('plugin:dialog|save', { options: { defaultPath: name } });
        if (!target) return null;
        if (ports.platform === 'android') {
          // content:// URI 须走 ContentResolver（std::fs 写不了），失败带步骤名详细报错
          try {
            await invoke('write_content_file', { uri: target, text: String(text) });
          } catch (e) {
            throw new Error('保存文件失败：' + (e?.message || e));
          }
          return target;
        }
        await invoke('write_file', { path: target, text: String(text) });
        return target;
      },
      // 接收：选择文件并读文本；返回 {name,text} | {name,error,detail} | null（取消）
      // detail 为逐步诊断信息（真机排障用）
      receive: async () => {
        if (ports.platform === 'android') {
          // Android 返回 content:// URI（std::fs 读不了）：主路径 read_content_file
          // （ContentResolver JNI），fetch 兜底。不传 filters：ACTION_GET_CONTENT 按
          // mime 过滤会挡住微信/QQ 下载的 octet-stream 文件
          let picked = null;
          try {
            picked = await invoke('plugin:dialog|open', { options: { multiple: false } });
          } catch (e) {
            return { name: '', error: true, detail: '选择器调用失败: ' + ((e && e.message) || e) };
          }
          // 归一化返回结构：字符串 / 数组 / {files:[...]}
          const uri = Array.isArray(picked)
            ? picked[0]
            : picked && typeof picked === 'object' && picked.files
              ? picked.files[0]
              : picked;
          if (picked == null || uri == null) return null; // 用户取消，静默
          if (typeof uri !== 'string') {
            // 结构异常：带出实际结构供诊断
            let shape = '';
            try { shape = JSON.stringify(picked).slice(0, 200); } catch (_) { shape = String(picked); }
            return { name: '', error: true, detail: '选择器返回异常结构: ' + shape };
          }
          const u = decodeURIComponent(uri);
          let name = baseName(u.split('?')[0]) || 'import';
          let text = null;
          const errs = [];
          try {
            text = await invoke('read_content_file', { uri });
          } catch (e1) {
            errs.push('原生读取: ' + ((e1 && e1.message) || e1));
            try {
              const resp = await fetch(uri);
              text = await resp.text();
            } catch (e2) {
              errs.push('fetch 读取: ' + ((e2 && e2.message) || e2));
            }
          }
          if (text == null) return { name, error: true, detail: errs.join('；') };
          // CSV 路由依赖扩展名：URI 提取不到扩展名时按内容补全
          if (!/\.[a-z0-9]+$/i.test(name)) {
            if (/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)) name = 'import.ics';
            else if (/^\s*[[{]/.test(text)) name = 'import.json';
            else if (text.includes(',') && text.includes('\n')) name = 'import.csv';
          }
          return { name, text };
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
          return { name: baseName(path), error: true, detail: '读取文件失败: ' + ((e && e.message) || e) };
        }
      }
    },
    // Android 状态栏图标颜色（浅色页面→深图标；深色页面→白图标）；其他平台为空。
    // 首选 MainActivity 注入的 JavascriptInterface（主线程可靠），
    // 注入缺失时回退 invoke 命令（Rust 主线程 JNI）
    statusBar: {
      setLightIcons: (light) => {
        const bridge = window.__campuserStatusBar;
        if (bridge && bridge.setLightIcons) {
          bridge.setLightIcons(!!light);
          return;
        }
        invoke('set_status_bar_icons', { light: !!light }).catch(() => {});
      }
    }
  };

  window.__ports = ports;
  invoke('os_platform')
    .then((p) => { ports.platform = p; })
    .catch(() => {});
})();
