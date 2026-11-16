const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const M = require('../core/model');
const root = path.resolve(__dirname, '..');

async function loadApp(t, overrides = {}) {
  let disk = null;
  const exports = [];
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), {
    url: 'http://localhost/src/index.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  win.requestAnimationFrame = () => 0; // DOM tests; actual layout is checked in Chromium separately.
  win.confirm = () => true;
  win.__ports = {
    storage: { load: async () => ({ text: disk, backup: null }), save: async text => { disk = text; }, ...overrides },
    share: { send: async (text, name) => { exports.push({ text, name }); return name; } }
  };
  for (const script of win.document.querySelectorAll('script[src]:not([type="module"])')) {
    const src = script.getAttribute('src').split('?')[0];
    if (src.includes('adapters/')) continue;
    win.eval(fs.readFileSync(path.resolve(root, 'src', src), 'utf8'));
  }
  const context = dom.getInternalVMContext(), cache = new Map();
  function module(file) {
    if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    return cache.get(file);
  }
  const entry = module(path.join(root, 'src/js/app.mjs'));
  await entry.link((specifier, parent) => module(path.resolve(path.dirname(parent.identifier), specifier)));
  await entry.evaluate();
  await entry.namespace.ready;
  return {
    win, $: id => win.document.getElementById(id),
    ui: name => module(path.join(root, 'src/js/ui', name + '.mjs')).namespace,
    disk: () => disk, exports
  };
}

test('module graph boots, adds/edits/deletes courses and persists before success', async t => {
  const app = await loadApp(t), editor = app.ui('course-editor');
  assert.equal(app.win.document.title, 'campuser');
  assert.equal(app.$('storageStatus').hidden, true, app.$('storageMessage').textContent);
  app.$('btnAdd').click();
  assert.equal(app.$('courseModal').hidden, false);
  app.$('f_name').value = '高等数学';
  await editor.saveCourseFromForm();
  assert.equal(JSON.parse(app.disk()).schedules[0].courses[0].name, '高等数学');
  assert.equal(app.$('courseModal').hidden, true);
  assert.ok(app.$('grid').querySelector('.course-block'));
  const course = app.ui('context').currentSchedule().courses[0];
  editor.openCourseModal('edit', course, course.timeSlots[0]);
  app.$('f_name').value = '线性代数';
  await editor.saveCourseFromForm();
  assert.equal(JSON.parse(app.disk()).schedules[0].courses[0].name, '线性代数');
  await editor.execDelete('course');
  assert.equal(JSON.parse(app.disk()).schedules[0].courses.length, 0);
});

test('failed save shows no success, retains one draft, exports and retries without duplication', async t => {
  let fail = true, saved;
  const app = await loadApp(t, { save: async text => { if (fail) throw new Error('disk full'); saved = text; } });
  app.$('btnAdd').click(); app.$('f_name').value = '未保存课程';
  await app.ui('course-editor').saveCourseFromForm();
  assert.match(app.$('storageMessage').textContent, /保存失败.*disk full/);
  assert.doesNotMatch(app.$('toast').textContent, /添加成功/);
  assert.equal(app.$('courseModal').inert, true);
  assert.equal(saved, undefined);
  await app.$('storageExport').onclick();
  assert.equal(JSON.parse(app.exports[0].text).schedules[0].courses.length, 1);
  assert.equal(app.exports[0].name, 'campuser-unsaved-backup.json');
  fail = false;
  await app.$('storageRetry').onclick();
  assert.equal(JSON.parse(saved).schedules[0].courses.length, 1);
  assert.equal(app.$('storageStatus').hidden, true);
  assert.equal(app.$('courseModal').hidden, true);
  assert.equal(app.$('courseModal').inert, false);
});

test('save success is deferred until disk acknowledges the write', async t => {
  let finish;
  const app = await loadApp(t, { save: () => new Promise(resolve => { finish = resolve; }) });
  app.$('btnAdd').click(); app.$('f_name').value = '等待保存';
  const pending = app.ui('course-editor').saveCourseFromForm();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.$('courseModal').hidden, false);
  assert.equal(app.$('btnAdd').closest('header').inert, true);
  assert.doesNotMatch(app.$('toast').textContent, /添加成功/);
  finish(); await pending;
  assert.equal(app.$('courseModal').hidden, true);
  assert.match(app.$('toast').textContent, /添加成功/);
});

test('load failure locks editing instead of starting over', async t => {
  let writes = 0;
  const app = await loadApp(t, { load: async () => ({ text: '{', backup: null }), save: async () => { writes++; } });
  assert.equal(app.ui('context').session.state, null);
  assert.match(app.$('storageMessage').textContent, /无法打开课表/);
  assert.equal(app.$('storageExport').hidden, true);
  assert.equal(app.$('btnAdd').onclick, null);
  assert.equal(writes, 0);
});

test('automatic backup recovery restores courses and reports recovery', async t => {
  const state = M.normalizeState({ schedules: [{ name: '恢复课表', courses: [{ name: '物理' }] }] });
  const app = await loadApp(t, { load: async () => ({ text: 'broken', backup: JSON.stringify(state) }) });
  assert.equal(app.ui('context').currentSchedule().name, '恢复课表');
  assert.equal(JSON.parse(app.disk()).schedules[0].courses[0].name, '物理');
  assert.match(app.$('toast').textContent, /自动备份恢复/);
});

test('settings, theme, schedule manager, CSV/JSON import and export remain functional', async t => {
  const app = await loadApp(t);
  app.ui('settings').openSettings();
  app.$('s_scheduleName').value = '新学期';
  await app.ui('settings').saveSettings();
  assert.equal(JSON.parse(app.disk()).schedules[0].name, '新学期');
  await app.ui('today').toggleTheme();
  assert.equal(JSON.parse(app.disk()).prefs.theme, 'dark');
  app.$('newScheduleName').value = '备用课表';
  await app.$('btnCreateSchedule').onclick();
  assert.equal(JSON.parse(app.disk()).schedules.length, 2);
  const schedule = M.normalizeSchedule({ name: '导入课表', courses: [{ name: '大学英语' }] });
  const csv = require('../core/codec/csv').toCsv(schedule);
  await app.ui('imports').handleImportText(csv, 'test.csv');
  assert.equal(app.ui('context').currentSchedule().courses[0].name, '大学英语');
  const backup = JSON.stringify(M.normalizeState({ schedules: [schedule] }));
  await app.ui('imports').handleImportText(backup, 'test.json');
  assert.equal(app.$('importChoiceModal').hidden, false);
  await app.ui('imports').confirmImportChoice();
  // Import-as-new is an async operation started by the choice handler.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(app.disk()).schedules.length, 3);
  await app.ui('transfer').doExportAction('backup-all');
  assert.match(app.exports[0].name, /^campuser-backup-/);
  assert.equal(JSON.parse(app.exports[0].text).schedules.length, 3);
});
