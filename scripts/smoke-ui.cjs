// Real Chromium regression check, using a temporary profile and synthetic courses only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'campuser-smoke-'));
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {}); // Keep the runner alive between source and packaged-resource windows.
setTimeout(() => { console.error('Chromium smoke check timed out'); app.exit(1); }, 30000).unref();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const report = [];
  for (const entry of ['src/index.html', 'dist/app/index.html']) {
    const win = new BrowserWindow({ show: false, width: 1280, height: 860,
      webPreferences: { offscreen: true, backgroundThrottling: false, partition: 'smoke-' + report.length, contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root, entry));
    await evaluate(`import('./js/app.mjs').then(m => m.ready)`);
    assert.equal(await evaluate('document.title'), 'campuser');
    assert.equal(await evaluate(`document.getElementById('storageStatus').hidden`), true);
    await evaluate(`document.getElementById('btnAdd').click(); document.getElementById('f_name').value = '高等数学'; document.getElementById('btnEditCourse').click();`);
    for (let i = 0; i < 50; i++) {
      if (await evaluate(`document.getElementById('courseModal').hidden`)) break;
      await delay(50);
    }
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('campuser-schedule-data')).schedules[0].courses[0].name`), '高等数学');
    await evaluate(`document.getElementById('nextWeek').click()`);
    assert.match(await evaluate(`document.getElementById('weekLabel').textContent`), /2/);
    await delay(350);
    fs.writeFileSync(path.join(output, `desktop-${report.length}.png`), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(390, 844);
    await delay(350);
    const size = await evaluate(`({width: innerWidth, scroll: document.documentElement.scrollWidth})`);
    assert.ok(size.scroll <= size.width, JSON.stringify(size));
    fs.writeFileSync(path.join(output, `mobile-${report.length}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.getElementById('btnMore').click(); document.getElementById('btnPanelSettings').click();`);
    assert.equal(await evaluate(`document.getElementById('settingsModal').hidden`), false);
    await delay(350);
    fs.writeFileSync(path.join(output, `settings-${report.length}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelectorAll('.modal-overlay').forEach(el => el.hidden = true);
      window.smokeSave = window.__ports.storage.save;
      window.__ports.storage.save = async () => { throw new Error('smoke: disk full'); };
      document.getElementById('btnAdd').click(); document.getElementById('f_name').value = '保存失败场景';
      document.querySelector('#slotList .sf-day').value = '2';
      document.getElementById('btnEditCourse').click();`);
    await delay(350);
    assert.match(await evaluate(`document.getElementById('storageMessage').textContent`), /保存失败/);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('campuser-schedule-data')).schedules[0].courses.length`), 1);
    fs.writeFileSync(path.join(output, `save-error-${report.length}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`window.__ports.storage.save = window.smokeSave; document.getElementById('storageRetry').click();`);
    await delay(350);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('campuser-schedule-data')).schedules[0].courses.length`), 2);
    assert.equal(await evaluate(`document.getElementById('storageStatus').hidden`), true);
    assert.deepEqual(errors, []);
    report.push({ entry, title: 'campuser', viewport: size, errors });
    win.destroy();
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, report }));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
