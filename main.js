// WakeUp课程表 本地版 - Electron 主进程
// 数据完全保存在本地 JSON 文件，无任何网络请求、无广告
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'schedule.json');

// 便携化：userData 指向项目内目录，所有数据（课表 JSON、Electron 配置）保存在本目录
app.setPath('userData', path.join(DATA_DIR, 'profile'));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ courses: [], settings: null }, null, 2), 'utf-8');
}

function loadData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return { courses: [], settings: null };
  }
}

function saveData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    title: 'WakeUp 课程表 - 本地版',
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

// ---------- IPC ----------
ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_e, data) => { saveData(data); return true; });

ipcMain.handle('dialog:openJson', async () => {
  const r = await dialog.showOpenDialog({
    title: '导入课程表 JSON 文件',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    return { path: r.filePaths[0], content: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf-8')) };
  } catch (e) {
    return { path: r.filePaths[0], error: String(e) };
  }
});

ipcMain.handle('dialog:saveJson', async (_e, data) => {
  const r = await dialog.showSaveDialog({
    title: '导出课程表',
    defaultPath: 'wakeup-schedule-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf-8');
  return r.filePath;
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
