const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../model');
const P = require('../persistence');
const { createFileStorage } = require('../../adapters/file-storage');
const json = name => JSON.stringify(M.normalizeState({ schedules: [{ name, courses: [] }] }));
const first = json('第一版'), second = json('第二版');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campuser-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'schedule.json');
}

test('missing data creates a new state; unreadable data never becomes an empty state', async () => {
  const fresh = P.createPersistence({ load: async () => ({ text: null, backup: null }) });
  assert.equal((await fresh.load()).state.schedules.length, 1);
  for (const bad of ['', '{', '{}', 'null', '[]', '{"schedules":[]}', '{"schedules":[{}]}']) {
    await assert.rejects(P.createPersistence({ load: async () => ({ text: bad }) }).load());
  }
  const failed = P.createPersistence({ load: async () => { throw new Error('permission denied'); } });
  await assert.rejects(failed.load(), /permission denied/);
  await assert.rejects(failed.save(M.normalizeState(null)), /禁止覆盖/);
});

test('damaged or missing primary recovers from backup; future versions never downgrade', async () => {
  for (const text of [null, '', '{', '{}']) {
    const result = await P.createPersistence({ load: async () => ({ text, backup: first }) }).load();
    assert.equal(result.recovered, true);
    assert.equal(result.state.schedules[0].name, '第一版');
  }
  const future = JSON.stringify({ ...JSON.parse(second), format: 'campuser-schedule/3' });
  await assert.rejects(P.createPersistence({ load: async () => ({ text: future, backup: first }) }).load(), /版本/);
  await assert.rejects(P.createPersistence({ load: async () => ({ text: '{', backup: '{}' }) }).load(), /均无法读取/);
});

test('file save rotates valid backup; corruption is archived unchanged before recovery', async t => {
  const file = temp(t), storage = createFileStorage(file);
  storage.save(first, { expected: null });
  storage.save(second, { expected: first });
  assert.deepEqual(storage.load(), { text: second, backup: first });
  fs.writeFileSync(file, 'truncated{');
  const service = P.createPersistence(storage), result = await service.load();
  await service.save(result.state);
  assert.equal(storage.load().backup, first);
  assert.equal(P.parseSnapshot(storage.load().text).schedules[0].name, '第一版');
  const archive = fs.readdirSync(path.dirname(file)).find(n => n.includes('.corrupt-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(file), archive), 'utf8'), 'truncated{');
});

for (const failure of ['writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`failure in ${failure} preserves primary and leaves no temporary file`, t => {
    const file = temp(t);
    createFileStorage(file).save(first, { expected: null });
    let calls = 0;
    const io = new Proxy(fs, { get(target, key) {
      if (key === failure) return (...args) => {
        // Fail when writing the primary, after the backup was safely written.
        if (++calls === 2) throw new Error('injected disk failure');
        return target[key](...args);
      };
      return target[key];
    } });
    assert.throws(() => createFileStorage(file, io).save(second, { expected: first }), /injected/);
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), first);
    assert.ok(!fs.readdirSync(path.dirname(file)).some(n => n.endsWith('.tmp')));
  });
}

test('stale writer and malformed save cannot overwrite another revision', t => {
  const storage = createFileStorage(temp(t));
  storage.save(first, { expected: null });
  assert.throws(() => storage.save(second, { expected: null }), /其他窗口/);
  assert.throws(() => storage.save('{}', { expected: first }));
  assert.equal(storage.load().text, first);
});

test('save queue captures snapshots in order and can retry after rejection', async () => {
  const writes = [];
  let reject = true;
  const service = P.createPersistence({
    load: async () => ({ text: first }),
    save: async (text, options) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (reject) throw new Error('full');
      writes.push({ text, expected: options.expected });
    }
  });
  const { state } = await service.load();
  await assert.rejects(service.save(state), /full/);
  assert.equal(service.unsettled, true);
  reject = false;
  state.schedules[0].name = 'A'; const a = service.save(state);
  state.schedules[0].name = 'B'; const b = service.save(state);
  assert.equal(service.unsettled, true);
  await Promise.all([a, b]);
  assert.deepEqual(writes.map(w => JSON.parse(w.text).schedules[0].name), ['A', 'B']);
  assert.equal(writes[1].expected, writes[0].text);
  assert.equal(service.unsettled, false);
});

function browser(initial = {}) {
  const data = new Map(Object.entries(initial));
  let fail = false;
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value); }
  };
  const window = { CampuserPersistence: P };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../adapters/browser-bridge.js'), 'utf8'), { window, localStorage, navigator: {} });
  return { data, port: window.__ports.storage, fail: () => { fail = true; } };
}

test('browser preserves legacy key, backup and draft when quota fails', async () => {
  const b = browser({ 'wakeup-schedule-data': first });
  assert.equal((await b.port.load()).text, first);
  await b.port.save(second, { expected: first });
  assert.equal(b.data.get('wakeup-schedule-data'), first);
  assert.equal(b.data.get('campuser-schedule-data.bak'), first);
  b.fail();
  await assert.rejects(b.port.save(first, { expected: second }), /quota/);
  assert.equal(b.data.get('campuser-schedule-data'), second);
});

test('browser rejects stale tab and preserves corrupt text on repair', async () => {
  const b = browser({ 'campuser-schedule-data': 'bad', 'campuser-schedule-data.bak': first });
  await b.port.save(first, { expected: 'bad' });
  assert.ok([...b.data].some(([key, value]) => key.includes('.corrupt-') && value === 'bad'));
  assert.equal(b.data.get('campuser-schedule-data.bak'), first);
  await assert.rejects(b.port.save(second, { expected: 'bad' }), /其他窗口/);
});

test('legacy v1 data is recognized for safe migration', async () => {
  const service = P.createPersistence({ load: async () => ({ text: '{"courses":[],"settings":null}' }) });
  const result = await service.load();
  assert.equal(result.migrated, true);
  assert.equal(result.state.format, M.FORMAT);
});
