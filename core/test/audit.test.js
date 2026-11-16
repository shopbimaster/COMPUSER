const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model');
const Bk = require('../codec/backup');
const Share = require('../codec/share');
const Merge = require('../merge');
const Week = require('../week');
const Adjust = require('../adjust');

test('day adjustments match the schedule when semester starts midweek', () => {
  const start = '2026-09-02';
  const date = Week.fmtDate(Week.dayDate(start, 2, 3));
  assert.equal(Adjust.dateOfWeekDay(start, 2, 3), date);
  assert.deepEqual(Adjust.weekDayOfDate(start, date, 20), { w: 2, d: 3 });
  assert.equal(Adjust.weekDayOfDate(start, '2026-02-31', 20), null);
});

test('custom-time slots cannot lose their distinct times during normalization', () => {
  const slots = [
    { day: 1, start: 1, step: 1, weeks: '111', customTime: { start: '08:10', end: '08:40' } },
    { day: 1, start: 1, step: 1, weeks: '111', customTime: { start: '08:45', end: '09:00' } },
    { day: 1, start: 2, step: 1, weeks: '111', customTime: { start: '09:10', end: '09:40' } },
    { day: 1, start: 1, step: 1, weeks: '111' }
  ];
  const course = M.normalizeCourse({ timeSlots: slots });
  assert.equal(course.timeSlots.length, 4);
  assert.equal(M.normalizeCourse(course).timeSlots.length, 4);
});

test('new campuser share codes also decode legacy WU codes', async () => {
  const schedule = M.normalizeSchedule({ name: '兼容课表' });
  const { code } = await Share.encodeShare(schedule);
  assert.match(code, /^CU[01]:/);
  const old = await Share.decodeShare(code.replace(/^CU/, 'WU'));
  assert.deepEqual(old.schedule, schedule);
  assert.match(require('../codec/ics').toIcs(schedule), /PRODID:-\/\/campuser\/\/CN\/\//);
});

test('unknown backup version is rejected rather than normalized and overwritten', () => {
  const incoming = { ...M.normalizeState(null), format: 'campuser-schedule/3' };
  assert.match(Bk.parseAuto(JSON.stringify(incoming)).error, /版本/);
});

test('merge handles imported IDs that match JavaScript prototype properties', () => {
  const a = M.normalizeState({ schedules: [{ id: '__proto__', courses: [{ id: '__proto__', name: 'A' }] }] });
  const b = M.normalizeState({ schedules: [{ id: '__proto__', courses: [{ id: 'constructor', name: 'B' }] }] });
  const merged = Merge.mergeState(a, b);
  assert.equal(merged.schedules.length, 1);
  assert.deepEqual(merged.schedules[0].courses.map(c => c.name).sort(), ['A', 'B']);
});

test('zero corner radius remains a valid setting', () => {
  assert.equal(M.normalizeSettings({ cornerRadius: 0 }).cornerRadius, 0);
});

test('development server serves module assets but never local data or tokens', async t => {
  const server = require('../../scripts/dev-server.cjs').createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/src/js/app.mjs')).status, 200);
  for (const name of ['/campus.token', '/data/schedule.json', '/src/../campus.token', '/src/%2e%2e%2fcampus.token']) {
    assert.equal((await fetch(base + name)).status, 404);
  }
});
