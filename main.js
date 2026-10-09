// CAMPUSER - Electron 主进程
// 数据完全保存在本地 JSON 文件，无任何网络请求、无广告
// 软件名等品牌信息统一取自 branding.js（唯一修改接口）
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const BRAND = require('./branding');

// 数据目录：安装版存 %APPDATA%（安装目录可能只读），开发/便携模式存项目内 data/
const isPortable = !app.isPackaged;
const DATA_DIR = isPortable
  ? path.join(__dirname, 'data')
  : path.join(app.getPath('userData'), 'data');
const DATA_FILE = path.join(DATA_DIR, 'schedule.json');

// 便携化：仅开发/便携模式把 userData 指向项目内目录；安装版保持系统默认
if (isPortable) app.setPath('userData', path.join(DATA_DIR, 'profile'));

// 一次性迁移：品牌更名前（wakeup-schedule-local）的安装版数据 → 现目录
if (isPackagedMigrationNeeded()) {
  try {
    fs.cpSync(migrationSourceDir(), DATA_DIR, { recursive: true });
    console.log('[migrate] imported data from legacy brand directory');
  } catch (e) {
    console.log('[migrate] skipped:', String(e));
  }
}

function migrationSourceDir() {
  return path.join(app.getPath('appData'), 'wakeup-schedule-local', 'data');
}
function isPackagedMigrationNeeded() {
  return (
    !isPortable &&
    !fs.existsSync(DATA_FILE) &&
    fs.existsSync(path.join(migrationSourceDir(), 'schedule.json'))
  );
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ courses: [], settings: null }, null, 2), 'utf-8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    title: BRAND.FULL_NAME,
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  // 将渲染进程的报错转发到终端，便于排查
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

// ---------- IPC（壳只做哑管道：文本进、文本出，语义由渲染进程的 core 决定） ----------
ipcMain.handle('data:load', () => {
  ensureDataFile();
  return fs.readFileSync(DATA_FILE, 'utf-8');
});

ipcMain.handle('data:save', (_e, text) => {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, String(text), 'utf-8');
  return true;
});

// 分享端口：文件导出（另存为对话框）
ipcMain.handle('share:exportFile', async (_e, payload) => {
  const r = await dialog.showSaveDialog({
    title: '导出文件',
    defaultPath: (payload && payload.defaultName) || `${BRAND.EXPORT_PREFIX}-export.txt`,
    filters: [{ name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, String((payload && payload.text) || ''), 'utf-8');
  return r.filePath;
});

// 分享端口：文件导入（打开对话框）
ipcMain.handle('share:importFile', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择导入文件',
    properties: ['openFile'],
    filters: [{ name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf-8') };
  } catch (e) {
    return { name: r.filePaths[0], error: String(e) };
  }
});

// 开机自启（安装版有效；便携/开发模式登录项需用户登录上下文，同样可用）
ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('autostart:set', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});

app.whenReady().then(() => {
  ensureDataFile();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
