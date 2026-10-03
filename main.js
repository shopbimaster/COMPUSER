// WakeUp课程表 本地版 - Electron 主进程
// 数据完全保存在本地 JSON 文件，无任何网络请求、无广告
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
    defaultPath: (payload && payload.defaultName) || 'wakeup-export.txt',
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
